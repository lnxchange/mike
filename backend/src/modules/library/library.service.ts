// Business logic + data access for the library module.
//
// The library is a union of the caller's personal shelf and every
// organisation they belong to. Each shelf has its own folder tree and
// write policy. These functions take an explicit Supabase client (`db`)
// plus request-derived primitives and RETURN typed results; the thin
// route handlers in library.routes.ts map them onto HTTP responses.

import { parseFolderPath, validateFolderMove, collectFolderSubtree } from "../../lib/folderTree";
import {
  librarySourceFor,
  resolveLibraryActor,
  type LibraryActor,
  type LibrarySource,
} from "../../lib/access";
import { can, type ProjectRole } from "../../lib/permissions";
import { renameDocument, deleteCollectionDocuments } from "../documents/documents.service";
import type { Db } from "../../lib/supabase";
import {
  attachActiveVersionPaths,
  attachLatestVersionNumbers,
} from "../../lib/documentVersions";
import type { PaginationParams } from "../../lib/pagination";

export type LibraryKind = "file" | "template";
export type { LibraryActor, LibrarySource };

export {
  resolveLibraryActor,
  librarySourceFor,
} from "../../lib/access";

const LIBRARY_IDS_PAGE_SIZE = 1000;
const LIBRARY_IDS_MAX_PAGES = 50;
const LIBRARY_BULK_DELETE_BATCH_SIZE = 100;
const SOURCE_FOLDER_PREFIX = "source:";
const PERSONAL_SOURCE_KEY = "personal";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeLibraryKind(value: unknown): LibraryKind | null {
  if (value === "file" || value === "files") return "file";
  if (value === "template" || value === "templates") return "template";
  return null;
}

export function isLibrarySourceFolderId(folderId: string): boolean {
  return folderId.startsWith(SOURCE_FOLDER_PREFIX);
}

export function sourceFolderId(orgId: string | null): string {
  return `${SOURCE_FOLDER_PREFIX}${orgId ?? PERSONAL_SOURCE_KEY}`;
}

/** `null` is personal; a uuid is that org; `undefined` is not a source key. */
export function parseLibrarySourceKey(
  value: string | null | undefined,
): string | null | undefined {
  if (value == null || value === "" || value === PERSONAL_SOURCE_KEY) return null;
  if (value.startsWith(SOURCE_FOLDER_PREFIX)) {
    return parseLibrarySourceKey(value.slice(SOURCE_FOLDER_PREFIX.length));
  }
  return UUID_RE.test(value) ? value : undefined;
}

function sourceLabel(actor: LibraryActor, orgId: string | null | undefined): string {
  return librarySourceFor(actor, orgId ?? null)?.label ?? (orgId ? "Organisation" : "Personal");
}

function sourceRole(
  actor: LibraryActor,
  orgId: string | null | undefined,
): ProjectRole | null {
  return librarySourceFor(actor, orgId ?? null)?.access_role ?? null;
}

function canWriteSource(
  actor: LibraryActor,
  orgId: string | null | undefined,
): boolean {
  return can(sourceRole(actor, orgId), "docs.organize");
}

function serializeSource(source: LibrarySource) {
  return {
    id: source.id,
    key: source.id ?? PERSONAL_SOURCE_KEY,
    label: source.label,
    access_role: source.access_role,
    folder_id: sourceFolderId(source.id),
  };
}

function virtualSourceFolder(
  actor: LibraryActor,
  source: LibrarySource,
  kind: LibraryKind,
) {
  return {
    id: sourceFolderId(source.id),
    user_id: actor.userId,
    org_id: source.id,
    library_kind: kind,
    name: source.label,
    parent_folder_id: null,
    created_at: null,
    updated_at: null,
    virtual: true,
    source_label: source.label,
    access_role: source.access_role,
  };
}

function decorateFolder(
  actor: LibraryActor,
  folder: Record<string, unknown>,
) {
  const orgId = (folder.org_id as string | null | undefined) ?? null;
  const source = librarySourceFor(actor, orgId);
  return {
    ...folder,
    source_label: source?.label ?? sourceLabel(actor, orgId),
    access_role: source?.access_role ?? "viewer",
    virtual: false,
  };
}

function mapLibraryDocument(
  actor: LibraryActor,
  doc: Record<string, unknown>,
) {
  const orgId = (doc.org_id as string | null | undefined) ?? null;
  const source = librarySourceFor(actor, orgId);
  return {
    ...doc,
    folder_id: (doc.library_folder_id as string | null | undefined) ?? null,
    org_id: orgId,
    source_label: source?.label ?? sourceLabel(actor, orgId),
    access_role: source?.access_role ?? "viewer",
  };
}

type LoadedFolder = {
  id: string;
  parent_folder_id: string | null;
  org_id: string | null;
  virtual?: boolean;
};

async function loadLibraryFolder(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  folderId: string,
): Promise<LoadedFolder | null> {
  if (isLibrarySourceFolderId(folderId)) {
    const orgId = parseLibrarySourceKey(folderId);
    if (orgId === undefined) return null;
    const source = librarySourceFor(actor, orgId);
    if (!source) return null;
    return {
      id: folderId,
      parent_folder_id: null,
      org_id: orgId,
      virtual: true,
    };
  }
  const { data } = await db
    .from("library_folders")
    .select("id, parent_folder_id, org_id, user_id")
    .eq("id", folderId)
    .eq("library_kind", kind)
    .maybeSingle();
  const folder = data as {
    id: string;
    parent_folder_id: string | null;
    org_id?: string | null;
    user_id?: string | null;
  } | null;
  if (!folder) return null;
  const orgId = folder.org_id ?? null;
  if (!librarySourceFor(actor, orgId)) return null;
  if (!orgId && folder.user_id !== actor.userId) return null;
  return {
    id: folder.id,
    parent_folder_id: folder.parent_folder_id,
    org_id: orgId,
  };
}

function applyDocumentShelf(
  query: ReturnType<Db["from"]>,
  actor: LibraryActor,
  kind: LibraryKind,
  orgId: string | null,
) {
  let next = query.is("project_id", null);
  if (orgId) next = next.eq("org_id", orgId);
  else next = next.eq("user_id", actor.userId).is("org_id", null);
  return kind === "file"
    ? next.or("library_kind.eq.file,library_kind.is.null")
    : next.eq("library_kind", kind);
}

function applyFolderShelf(
  query: ReturnType<Db["from"]>,
  actor: LibraryActor,
  kind: LibraryKind,
  orgId: string | null,
) {
  let next = query.eq("library_kind", kind);
  if (orgId) return next.eq("org_id", orgId);
  return next.eq("user_id", actor.userId).is("org_id", null);
}

export type ServiceOk<T> = { ok: true; data: T };
export type ServiceErr =
  | { ok: false; failure: "status"; status: number; detail: string }
  | { ok: false; failure: "internal"; error: unknown };
export type ServiceResult<T> = ServiceOk<T> | ServiceErr;

const ok = <T>(data: T): ServiceOk<T> => ({ ok: true, data });
const err = (status: number, detail: string): ServiceErr => ({
  ok: false,
  failure: "status",
  status,
  detail,
});
const internalErr = (error: unknown): ServiceErr => ({
  ok: false,
  failure: "internal",
  error,
});

function writeDenied(): ServiceErr {
  return err(403, "You do not have permission to change this library.");
}

function libraryMeta(actor: LibraryActor) {
  return { sources: actor.sources.map(serializeSource) };
}

async function loadLibraryLevel(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  parentFolderId: string | null,
  orgId: string | null,
  pagination: PaginationParams,
) {
  let documentsQuery = applyDocumentShelf(
    db.from("documents").select("*"),
    actor,
    kind,
    orgId,
  );
  documentsQuery =
    parentFolderId === null
      ? documentsQuery.is("library_folder_id", null)
      : documentsQuery.eq("library_folder_id", parentFolderId);
  documentsQuery = documentsQuery.range(
    pagination.offset,
    pagination.offset + pagination.limit,
  );

  let foldersQuery = applyFolderShelf(
    db.from("library_folders").select("*"),
    actor,
    kind,
    orgId,
  );
  foldersQuery =
    parentFolderId === null
      ? foldersQuery.is("parent_folder_id", null)
      : foldersQuery.eq("parent_folder_id", parentFolderId);

  const [{ data: docs, error: docsError }, { data: folders, error: foldersError }] =
    await Promise.all([
      documentsQuery.order("updated_at", { ascending: false }),
      foldersQuery.order("updated_at", { ascending: false }),
    ]);
  if (docsError)
    return {
      error: docsError.message,
      documents: [],
      folders: [],
      documentsHasMore: false,
    };
  if (foldersError)
    return {
      error: foldersError.message,
      documents: [],
      folders: [],
      documentsHasMore: false,
    };

  const rawDocs = docs ?? [];
  const documentsHasMore = rawDocs.length > pagination.limit;
  const pageDocs = documentsHasMore ? rawDocs.slice(0, pagination.limit) : rawDocs;
  const docsTyped = pageDocs.map((doc) =>
    mapLibraryDocument(actor, doc as Record<string, unknown>),
  ) as { id: string; current_version_id?: string | null }[];
  await attachLatestVersionNumbers(db, docsTyped);
  await attachActiveVersionPaths(db, docsTyped);
  return {
    error: null,
    documents: docsTyped,
    folders: (folders ?? []).map((folder) =>
      decorateFolder(actor, folder as Record<string, unknown>),
    ),
    documentsHasMore,
  };
}

function unionRootFolders(actor: LibraryActor, kind: LibraryKind) {
  return actor.sources.map((source) => virtualSourceFolder(actor, source, kind));
}

export async function getLibrary(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  parentFolderId: string | null,
  pagination: PaginationParams,
): Promise<
  ServiceResult<{
    documents: unknown[];
    folders: unknown[];
    documentsHasMore: boolean;
    sources: ReturnType<typeof serializeSource>[];
  }>
> {
  if (!parentFolderId && actor.sources.length > 1) {
    return ok({
      documents: [],
      folders: unionRootFolders(actor, kind),
      documentsHasMore: false,
      ...libraryMeta(actor),
    });
  }

  let orgId: string | null = null;
  let realParentId: string | null = parentFolderId;
  if (parentFolderId) {
    const folder = await loadLibraryFolder(db, actor, kind, parentFolderId);
    if (!folder) return err(404, "Folder not found");
    orgId = folder.org_id;
    realParentId = folder.virtual ? null : folder.id;
  }

  const result = await loadLibraryLevel(
    db,
    actor,
    kind,
    realParentId,
    orgId,
    pagination,
  );
  if (result.error) return err(500, result.error);
  return ok({
    documents: result.documents,
    folders: result.folders,
    documentsHasMore: result.documentsHasMore,
    ...libraryMeta(actor),
  });
}

export async function searchLibraryDocuments(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  searchTerm: string | null,
  fileType: string | null,
  sort: { key: string; direction: "asc" | "desc" },
  pagination: PaginationParams,
): Promise<
  ServiceResult<{
    documents: unknown[];
    documentsHasMore: boolean;
    sources: ReturnType<typeof serializeSource>[];
  }>
> {
  const { data, error } = await db.rpc("search_library_documents", {
    p_user_id: actor.userId,
    p_library_kind: kind,
    p_limit: pagination.limit + 1,
    p_offset: pagination.offset,
    p_search_term: searchTerm,
    p_file_type: fileType,
    p_sort_key: sort.key,
    p_sort_direction: sort.direction,
    p_org_ids: actor.sources.flatMap((source) => (source.id ? [source.id] : [])),
  });
  if (error) return internalErr(error);

  const rows = (data ?? []) as Record<string, unknown>[];
  return ok({
    documents: rows
      .slice(0, pagination.limit)
      .map((row) => mapLibraryDocument(actor, row)),
    documentsHasMore: rows.length > pagination.limit,
    ...libraryMeta(actor),
  });
}

export async function getLibraryLevels(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  levels: Array<{ parentId: string | null; limit: number }>,
): Promise<
  ServiceResult<{
    levels: Array<{
      parentId: string | null;
      documents: unknown[];
      folders: unknown[];
      documentsHasMore: boolean;
    }>;
    sources: ReturnType<typeof serializeSource>[];
  }>
> {
  const results: Array<{
    parentId: string | null;
    result: Awaited<ReturnType<typeof loadLibraryLevel>> & {
      virtualRoot?: boolean;
    };
  }> = new Array(levels.length);
  let nextLevelIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, levels.length) }, async () => {
      while (nextLevelIndex < levels.length) {
        const index = nextLevelIndex++;
        const level = levels[index];
        if (!level.parentId && actor.sources.length > 1) {
          results[index] = {
            parentId: level.parentId,
            result: {
              error: null,
              documents: [],
              folders: unionRootFolders(actor, kind),
              documentsHasMore: false,
              virtualRoot: true,
            },
          };
          continue;
        }
        let orgId: string | null = null;
        let realParentId: string | null = level.parentId;
        if (level.parentId) {
          const folder = await loadLibraryFolder(db, actor, kind, level.parentId);
          if (!folder) {
            results[index] = {
              parentId: level.parentId,
              result: {
                error: "Folder not found",
                documents: [],
                folders: [],
                documentsHasMore: false,
              },
            };
            continue;
          }
          orgId = folder.org_id;
          realParentId = folder.virtual ? null : folder.id;
        }
        results[index] = {
          parentId: level.parentId,
          result: await loadLibraryLevel(db, actor, kind, realParentId, orgId, {
            limit: level.limit,
            offset: 0,
          }),
        };
      }
    }),
  );
  const missing = results.find(({ result }) => result.error === "Folder not found");
  if (missing) return err(404, "Folder not found");
  const failed = results.find(({ result }) => result.error);
  if (failed?.result.error) return err(500, failed.result.error);
  return ok({
    levels: results.map(({ parentId, result }) => ({
      parentId,
      documents: result.documents,
      folders: result.folders,
      documentsHasMore: result.documentsHasMore,
    })),
    ...libraryMeta(actor),
  });
}

export async function getLibraryFilterOptions(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
): Promise<ServiceResult<{ fileTypes: string[]; sources: ReturnType<typeof serializeSource>[] }>> {
  const { data, error } = await db.rpc("get_library_filter_options", {
    p_user_id: actor.userId,
    p_library_kind: kind,
    p_org_ids: actor.sources.flatMap((source) => (source.id ? [source.id] : [])),
  });
  if (error) return internalErr(error);
  const row = (data?.[0] ?? {}) as { file_types?: unknown };
  return ok({
    fileTypes: Array.isArray(row.file_types)
      ? row.file_types.filter((value): value is string => typeof value === "string")
      : [],
    ...libraryMeta(actor),
  });
}

export async function getLibraryDocumentIds(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  searchTerm: string | null,
  fileType: string | null,
): Promise<ServiceResult<string[]>> {
  const ids: string[] = [];
  let offset = 0;
  for (let page = 0; page < LIBRARY_IDS_MAX_PAGES; page++) {
    const { data, error } = await db.rpc("get_library_document_ids", {
      p_user_id: actor.userId,
      p_library_kind: kind,
      p_search_term: searchTerm,
      p_file_type: fileType,
      p_limit: LIBRARY_IDS_PAGE_SIZE,
      p_offset: offset,
      p_org_ids: actor.sources.flatMap((source) => (source.id ? [source.id] : [])),
    });
    if (error) return internalErr(error);
    const rows = (data ?? []) as { id: string }[];
    if (rows.length === 0) break;
    ids.push(...rows.map((row) => row.id));
    offset += rows.length;
  }
  return ok(ids);
}

export async function bulkDeleteLibraryDocuments(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  ids: string[],
): Promise<ServiceResult<{ deletedIds: string[] }>> {
  const writableOrgIds = actor.sources
    .filter((source) => source.id && canWriteSource(actor, source.id))
    .map((source) => source.id as string);
  const deletedIds: string[] = [];
  for (
    let offset = 0;
    offset < ids.length;
    offset += LIBRARY_BULK_DELETE_BATCH_SIZE
  ) {
    const batch = ids.slice(offset, offset + LIBRARY_BULK_DELETE_BATCH_SIZE);
    const result = await deleteCollectionDocuments(
      db,
      {
        kind: "library",
        userId: actor.userId,
        libraryKind: kind,
        writableOrgIds,
      },
      batch,
    );
    if (!result.ok) {
      return result.kind === "error"
        ? internalErr(result.error)
        : err(500, result.detail);
    }
    deletedIds.push(...result.data.deletedIds);
  }
  return ok({ deletedIds });
}

export async function getLibraryFolderPath(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  folderId: string,
): Promise<ServiceResult<{ folders: unknown[]; sources: ReturnType<typeof serializeSource>[] }>> {
  if (isLibrarySourceFolderId(folderId)) {
    const orgId = parseLibrarySourceKey(folderId);
    if (orgId === undefined) return err(404, "Folder not found");
    const source = librarySourceFor(actor, orgId);
    if (!source) return err(404, "Folder not found");
    return ok({
      folders: [virtualSourceFolder(actor, source, kind)],
      ...libraryMeta(actor),
    });
  }

  const orgIds = actor.sources
    .map((source) => source.id)
    .filter((id): id is string => !!id);
  const [personalResult, orgResult] = await Promise.all([
    applyFolderShelf(
      db.from("library_folders").select("*"),
      actor,
      kind,
      null,
    ),
    orgIds.length > 0
      ? db.from("library_folders").select("*").eq("library_kind", kind).in("org_id", orgIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (personalResult.error) return internalErr(personalResult.error);
  if (orgResult.error) return internalErr(orgResult.error);
  const folders = [...(personalResult.data ?? []), ...(orgResult.data ?? [])];
  const foldersById = new Map(folders.map((folder) => [folder.id as string, folder]));
  const path: typeof folders = [];
  const visited = new Set<string>();
  let current = foldersById.get(folderId);
  if (!current) return err(404, "Folder not found");

  while (current && !visited.has(current.id as string)) {
    visited.add(current.id as string);
    path.unshift(decorateFolder(actor, current as Record<string, unknown>));
    current = current.parent_folder_id
      ? foldersById.get(current.parent_folder_id as string)
      : undefined;
  }

  const rootOrgId = ((path[0] as { org_id?: string | null } | undefined)?.org_id) ?? null;
  if (actor.sources.length > 1) {
    const source = librarySourceFor(actor, rootOrgId);
    if (source) path.unshift(virtualSourceFolder(actor, source, kind));
  }

  return ok({ folders: path, ...libraryMeta(actor) });
}

export async function resolveLibraryWriteTarget(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  body: { folder_id?: string | null; org_id?: string | null },
): Promise<ServiceResult<{ orgId: string | null; folderId: string | null }>> {
  let orgId = body.org_id ?? null;
  let folderId = body.folder_id ?? null;
  if (folderId && isLibrarySourceFolderId(folderId)) {
    const parsed = parseLibrarySourceKey(folderId);
    if (parsed === undefined) return err(404, "Folder not found");
    orgId = parsed;
    folderId = null;
  } else if (folderId) {
    const folder = await loadLibraryFolder(db, actor, kind, folderId);
    if (!folder || folder.virtual) return err(404, "Folder not found");
    orgId = folder.org_id;
  } else if (body.org_id !== undefined) {
    const parsed = parseLibrarySourceKey(
      body.org_id === null ? PERSONAL_SOURCE_KEY : body.org_id,
    );
    if (parsed === undefined) return err(400, "Invalid library source");
    orgId = parsed;
  }
  if (!librarySourceFor(actor, orgId)) return err(404, "Library not found");
  if (!canWriteSource(actor, orgId)) return writeDenied();
  return ok({ orgId, folderId });
}

export async function resolveLibraryFolderPath(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  body: {
    base_folder_id?: string | null;
    org_id?: string | null;
    segments?: unknown;
    conflict_resolution?: unknown;
  },
): Promise<ServiceResult<unknown>> {
  const path = parseFolderPath(body);
  if (!path) return err(400, "Invalid folder path");
  const { segments, conflictResolution, baseFolderId } = path;
  const target = await resolveLibraryWriteTarget(db, actor, kind, {
    folder_id: baseFolderId,
    org_id: body.org_id ?? null,
  });
  if (!target.ok) return target;

  const { data, error } = await db.rpc("resolve_library_folder_path", {
    target_user_id: actor.userId,
    target_library_kind: kind,
    base_folder_id: target.data.folderId,
    path_segments: segments,
    conflict_resolution: conflictResolution,
    target_org_id: target.data.orgId,
  });
  if (error) return internalErr(error);
  return ok(data);
}

export async function createLibraryFolder(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  body: {
    name?: string;
    parent_folder_id?: string | null;
    org_id?: string | null;
  },
): Promise<ServiceResult<unknown>> {
  const name = body.name?.trim();
  if (!name) return err(400, "name is required");
  const target = await resolveLibraryWriteTarget(db, actor, kind, {
    folder_id: body.parent_folder_id ?? null,
    org_id: body.org_id ?? null,
  });
  if (!target.ok) return target;

  const { data, error } = await db
    .from("library_folders")
    .insert({
      user_id: actor.userId,
      org_id: target.data.orgId,
      library_kind: kind,
      name,
      parent_folder_id: target.data.folderId,
    })
    .select("*")
    .single();
  if (error) return internalErr(error);
  return ok(decorateFolder(actor, data as Record<string, unknown>));
}

export async function updateLibraryFolder(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  folderId: string,
  body: { name?: string; parent_folder_id?: string | null },
): Promise<ServiceResult<unknown>> {
  const folder = await loadLibraryFolder(db, actor, kind, folderId);
  if (!folder || folder.virtual) return err(404, "Folder not found");
  if (!canWriteSource(actor, folder.org_id)) return writeDenied();

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.name != null) {
    const trimmed = body.name.trim();
    if (!trimmed) return err(400, "name is required");
    updates.name = trimmed;
  }
  if ("parent_folder_id" in body) {
    if (body.parent_folder_id) {
      if (isLibrarySourceFolderId(body.parent_folder_id)) {
        const destOrg = parseLibrarySourceKey(body.parent_folder_id);
        if (destOrg === undefined) return err(404, "Parent folder not found");
        if (destOrg !== folder.org_id) {
          return err(400, "Cannot move a folder into a different library");
        }
        updates.parent_folder_id = null;
      } else {
        const moveError = await validateFolderMove(
          folderId,
          body.parent_folder_id,
          (id) => loadLibraryFolder(db, actor, kind, id),
        );
        if (moveError === "cycle")
          return err(400, "Cannot move a folder into itself or a descendant");
        if (moveError) return err(404, "Parent folder not found");
        const dest = await loadLibraryFolder(db, actor, kind, body.parent_folder_id);
        if (!dest) return err(404, "Parent folder not found");
        if (dest.org_id !== folder.org_id) {
          return err(400, "Cannot move a folder into a different library");
        }
        updates.parent_folder_id = dest.virtual ? null : dest.id;
      }
    } else {
      updates.parent_folder_id = null;
    }
  }

  let query = db
    .from("library_folders")
    .update(updates)
    .eq("id", folderId)
    .eq("library_kind", kind);
  query = folder.org_id
    ? query.eq("org_id", folder.org_id)
    : query.eq("user_id", actor.userId).is("org_id", null);
  const { data, error } = await query.select("*").single();
  if (error || !data) return err(404, "Folder not found");
  return ok(decorateFolder(actor, data as Record<string, unknown>));
}

export async function deleteLibraryFolder(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  folderId: string,
): Promise<ServiceResult<null>> {
  const folder = await loadLibraryFolder(db, actor, kind, folderId);
  if (!folder || folder.virtual) return err(404, "Folder not found");
  if (!canWriteSource(actor, folder.org_id)) return writeDenied();

  const { data: allFolders, error: foldersError } = await applyFolderShelf(
    db.from("library_folders").select("id, parent_folder_id"),
    actor,
    kind,
    folder.org_id,
  );
  if (foldersError) return internalErr(foldersError);
  if (!(allFolders ?? []).some((row) => row.id === folderId)) {
    return err(404, "Folder not found");
  }

  const folderIds = collectFolderSubtree(folderId, allFolders ?? []);
  const { data: docs, error: docsError } = await applyDocumentShelf(
    db.from("documents").select("id"),
    actor,
    kind,
    folder.org_id,
  ).in("library_folder_id", [...folderIds]);
  if (docsError) return internalErr(docsError);

  const docIds = (docs ?? []).map((doc) => doc.id as string);
  const deleteDocsResult = await deleteCollectionDocuments(
    db,
    {
      kind: "library",
      userId: actor.userId,
      libraryKind: kind,
      writableOrgIds: folder.org_id ? [folder.org_id] : [],
    },
    docIds,
  );
  if (!deleteDocsResult.ok) {
    return deleteDocsResult.kind === "error"
      ? internalErr(deleteDocsResult.error)
      : err(500, deleteDocsResult.detail);
  }

  let deleteQuery = db
    .from("library_folders")
    .delete()
    .eq("id", folderId)
    .eq("library_kind", kind);
  deleteQuery = folder.org_id
    ? deleteQuery.eq("org_id", folder.org_id)
    : deleteQuery.eq("user_id", actor.userId).is("org_id", null);
  const { error } = await deleteQuery;
  if (error) return internalErr(error);
  return ok(null);
}

export async function moveLibraryDocument(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  documentId: string,
  folder_id: string | null,
): Promise<ServiceResult<unknown>> {
  const { data: existing, error: existingError } = await db
    .from("documents")
    .select("id, org_id, user_id")
    .eq("id", documentId)
    .is("project_id", null)
    .maybeSingle();
  if (existingError) return internalErr(existingError);
  const doc = existing as {
    id: string;
    org_id?: string | null;
    user_id?: string | null;
  } | null;
  if (!doc) return err(404, "Document not found");
  const orgId = doc.org_id ?? null;
  if (!librarySourceFor(actor, orgId)) return err(404, "Document not found");
  if (!orgId && doc.user_id !== actor.userId) return err(404, "Document not found");
  if (!canWriteSource(actor, orgId)) return writeDenied();

  let destFolderId: string | null = folder_id;
  if (folder_id) {
    const folder = await loadLibraryFolder(db, actor, kind, folder_id);
    if (!folder) return err(404, "Folder not found");
    if (folder.org_id !== orgId) {
      return err(400, "Cannot move a document into a different library");
    }
    destFolderId = folder.virtual ? null : folder.id;
  }

  const { data, error } = await applyDocumentShelf(
    db.from("documents").update({
      library_folder_id: destFolderId,
      updated_at: new Date().toISOString(),
    }),
    actor,
    kind,
    orgId,
  )
    .eq("id", documentId)
    .select("*")
    .single();
  if (error || !data) return err(404, "Document not found");
  return ok(mapLibraryDocument(actor, data as Record<string, unknown>));
}

export async function renameLibraryDocument(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  documentId: string,
  rawFilename: unknown,
): Promise<ServiceResult<unknown>> {
  const { data: existing, error: existingError } = await db
    .from("documents")
    .select("id, org_id, user_id")
    .eq("id", documentId)
    .is("project_id", null)
    .maybeSingle();
  if (existingError) return internalErr(existingError);
  const doc = existing as {
    id: string;
    org_id?: string | null;
    user_id?: string | null;
  } | null;
  if (!doc) return err(404, "Document not found");
  const orgId = doc.org_id ?? null;
  if (!librarySourceFor(actor, orgId)) return err(404, "Document not found");
  if (!orgId && doc.user_id !== actor.userId) return err(404, "Document not found");
  if (!canWriteSource(actor, orgId)) return writeDenied();

  const result = await renameDocument(db, {
    userId: actor.userId,
    documentId,
    filename: rawFilename,
    scope: { kind: "library", libraryKind: kind, orgId },
  });
  if (result.ok) return ok(mapLibraryDocument(actor, result.data));
  if (result.kind === "error") return internalErr(result.error);
  return err(result.kind === "validation" ? 400 : 404, result.detail);
}
