// Business logic + data access for the library module.
//
// Two listing models share this file:
//
// - Workspace (the HTTP routes): a person's own documents and folders in
//   Personal, and their own in each organization they belong to. A folder
//   and what is in it stay in one workspace.
// - Org shelves: the caller's personal shelf plus every organisation they
//   belong to, each with its own folder tree and write policy. Callers pass
//   a LibraryActor (search, chat hits, and the shelf tests).
//
// These functions take an explicit Supabase client (`db`) plus request-derived
// primitives and RETURN typed results; library.routes.ts maps them onto HTTP.

import { parseFolderPath, validateFolderMove, walkFolderGraph, collectFolderSubtree } from "../../lib/folderTree";
import { readFolderSubtree } from "../../lib/folderSubtree";
import { ID_FILTER_BATCH_SIZE } from "../../lib/batchedQuery";
import { chunkArray } from "../../lib/arrays";
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
import {
  PERSONAL_WORKSPACE,
  workspaceRpcArg,
  type WorkspaceFilter,
} from "../../lib/workspace";

export type { LibraryActor, LibrarySource };
export { resolveLibraryActor, librarySourceFor } from "../../lib/access";

export type LibraryKind = "file" | "template";

const LIBRARY_IDS_PAGE_SIZE = 1000;
const LIBRARY_IDS_MAX_PAGES = 50;
const LIBRARY_BULK_DELETE_BATCH_SIZE = 100;

export function normalizeLibraryKind(value: unknown): LibraryKind | null {
  if (value === "file" || value === "files") return "file";
  if (value === "template" || value === "templates") return "template";
  return null;
}

// The library is per workspace: a person's own documents and folders in
// Personal, and their own in each organization they belong to. `workspace`
// narrows every list here to one of them — "personal", an organization id,
// or null for a caller that predates workspaces, which is not narrowed.
//
// Whatever the caller asks to see, a folder and what is in it are always in
// the same workspace: a document is never moved into another workspace's
// folder, and a new folder takes its parent's.

// The query builders' own types are too deep to thread through a generic
// constraint, so these ask only for the two filters they use.
type OrgNarrowable = {
  eq(column: string, value: string): unknown;
  is(column: string, value: null): unknown;
};

/** Narrow a documents or library_folders query to one workspace. */
function inWorkspace<Q>(query: Q, workspace: WorkspaceFilter): Q {
  if (!workspace) return query;
  const narrowable = query as unknown as OrgNarrowable;
  return (
    workspace === PERSONAL_WORKSPACE
      ? narrowable.is("org_id", null)
      : narrowable.eq("org_id", workspace)
  ) as Q;
}

/** Narrow a query to exactly the workspace `orgId` names (null: Personal). */
function inOrg<Q>(query: Q, orgId: string | null): Q {
  const narrowable = query as unknown as OrgNarrowable;
  return (
    orgId ? narrowable.eq("org_id", orgId) : narrowable.is("org_id", null)
  ) as Q;
}

/** The org_id a new row gets in `workspace`: null for Personal or unscoped. */
function workspaceOrgId(workspace: WorkspaceFilter): string | null {
  return workspace && workspace !== PERSONAL_WORKSPACE ? workspace : null;
}

type LibraryFolderRef = {
  id: string;
  parent_folder_id: string | null;
  org_id: string | null;
};

function ws_mapLibraryDocument<T extends Record<string, unknown>>(doc: T) {
  return {
    ...doc,
    folder_id: (doc.library_folder_id as string | null | undefined) ?? null,
  };
}

async function ws_loadLibraryFolder(
  db: Db,
  userId: string,
  kind: LibraryKind,
  folderId: string,
  workspace: WorkspaceFilter = null,
): Promise<LibraryFolderRef | null> {
  const { data } = await inWorkspace(
    db
      .from("library_folders")
      .select("id, parent_folder_id, org_id")
      .eq("id", folderId)
      .eq("user_id", userId)
      .eq("library_kind", kind),
    workspace,
  ).maybeSingle();
  if (!data) return null;
  const row = data as Partial<LibraryFolderRef> & { id: string };
  return {
    id: row.id,
    parent_folder_id: row.parent_folder_id ?? null,
    org_id: row.org_id ?? null,
  };
}

async function deleteLibraryDocumentsAndVersionFiles(
  db: Db,
  userId: string,
  kind: LibraryKind,
  documentIds: string[],
) {
  const result = await deleteCollectionDocuments(
    db, { kind: "library", userId, libraryKind: kind }, documentIds,
  );
  return result.ok
    ? { error: null, deletedIds: result.data.deletedIds }
    : {
        error: result.kind === "error" ? result.error : result.detail,
        deletedIds: [],
      };
}

export type ServiceOk<T> = { ok: true; data: T };
// Two shapes of failure, because the HTTP layer answers them differently:
// "status" carries a caller-facing status + detail (bad input, missing row);
// "internal" carries the raw driver error, which the route hands to
// sendInternalError so the message is logged rather than echoed to the client.
export type ServiceErr =
  | { ok: false; failure: "status"; status: number; detail: string }
  | { ok: false; failure: "internal"; error: unknown };
export type ServiceResult<T> = ServiceOk<T> | ServiceErr;

const ws_ok = <T>(data: T): ServiceOk<T> => ({ ok: true, data });
const ws_err = (status: number, detail: string): ServiceErr => ({
  ok: false,
  failure: "status",
  status,
  detail,
});
const ws_internalErr = (error: unknown): ServiceErr => ({
  ok: false,
  failure: "internal",
  error,
});

// Folders per level are assumed to stay small (organizational containers,
// not user data that grows unbounded) and are always returned in full.
// Documents are the part that can grow into the thousands, so only they're
// paginated — one extra row is fetched over `limit` to detect `hasMore`
// without a separate count query.
async function ws_loadLibraryLevel(
  db: Db,
  userId: string,
  kind: LibraryKind,
  parentFolderId: string | null,
  pagination: PaginationParams,
  workspace: WorkspaceFilter = null,
) {
  let documentsQuery = inWorkspace(
    db
      .from("documents")
      .select("*")
      .eq("user_id", userId)
      .is("project_id", null),
    workspace,
  );
  documentsQuery =
    parentFolderId === null
      ? documentsQuery.is("library_folder_id", null)
      : documentsQuery.eq("library_folder_id", parentFolderId);
  documentsQuery =
    kind === "file"
      ? documentsQuery.or("library_kind.eq.file,library_kind.is.null")
      : documentsQuery.eq("library_kind", kind);
  documentsQuery = documentsQuery.range(
    pagination.offset,
    pagination.offset + pagination.limit,
  );

  let foldersQuery = inWorkspace(
    db
      .from("library_folders")
      .select("*")
      .eq("user_id", userId)
      .eq("library_kind", kind),
    workspace,
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

  const docsTyped = pageDocs.map(ws_mapLibraryDocument) as {
    id: string;
    current_version_id?: string | null;
  }[];
  await attachLatestVersionNumbers(db, docsTyped);
  await attachActiveVersionPaths(db, docsTyped);
  return {
    error: null,
    documents: docsTyped,
    folders: folders ?? [],
    documentsHasMore,
  };
}

async function ws_getLibrary(
  db: Db,
  userId: string,
  kind: LibraryKind,
  parentFolderId: string | null,
  pagination: PaginationParams,
  workspace: WorkspaceFilter = null,
): Promise<
  ServiceResult<{
    documents: unknown[];
    folders: unknown[];
    documentsHasMore: boolean;
  }>
> {
  if (parentFolderId) {
    const folder = await ws_loadLibraryFolder(
      db,
      userId,
      kind,
      parentFolderId,
      workspace,
    );
    if (!folder) return ws_err(404, "Folder not found");
  }
  const result = await ws_loadLibraryLevel(
    db,
    userId,
    kind,
    parentFolderId,
    pagination,
    workspace,
  );
  if (result.error) return ws_err(500, result.error);
  return ws_ok({
    documents: result.documents,
    folders: result.folders,
    documentsHasMore: result.documentsHasMore,
  });
}

async function ws_searchLibraryDocuments(
  db: Db,
  userId: string,
  kind: LibraryKind,
  searchTerm: string | null,
  fileType: string | null,
  sort: { key: string; direction: "asc" | "desc" },
  pagination: PaginationParams,
  workspace: WorkspaceFilter = null,
): Promise<ServiceResult<{ documents: unknown[]; documentsHasMore: boolean }>> {
  const { data, error } = await db.rpc("search_library_documents", {
    p_user_id: userId,
    p_library_kind: kind,
    p_limit: pagination.limit + 1,
    p_offset: pagination.offset,
    p_search_term: searchTerm,
    p_file_type: fileType,
    p_sort_key: sort.key,
    p_sort_direction: sort.direction,
    ...workspaceRpcArg(workspace),
  });
  if (error) return ws_internalErr(error);

  const rows = (data ?? []) as Record<string, unknown>[];
  return ws_ok({
    documents: rows.slice(0, pagination.limit).map(ws_mapLibraryDocument),
    documentsHasMore: rows.length > pagination.limit,
  });
}

async function ws_getLibraryLevels(
  db: Db,
  userId: string,
  kind: LibraryKind,
  levels: Array<{ parentId: string | null; limit: number }>,
  workspace: WorkspaceFilter = null,
): Promise<
  ServiceResult<{
    levels: Array<{
      parentId: string | null;
      documents: unknown[];
      folders: unknown[];
      documentsHasMore: boolean;
    }>;
  }>
> {
  const results: Array<{
    parentId: string | null;
    result: Awaited<ReturnType<typeof ws_loadLibraryLevel>>;
  }> = new Array(levels.length);
  let nextLevelIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, levels.length) }, async () => {
      while (nextLevelIndex < levels.length) {
        const index = nextLevelIndex++;
        const level = levels[index];
        results[index] = {
          parentId: level.parentId,
          result: await ws_loadLibraryLevel(
            db,
            userId,
            kind,
            level.parentId,
            { limit: level.limit, offset: 0 },
            workspace,
          ),
        };
      }
    }),
  );
  const failed = results.find(({ result }) => result.error);
  if (failed?.result.error) return ws_err(500, failed.result.error);
  return ws_ok({
    levels: results.map(({ parentId, result }) => ({
      parentId,
      documents: result.documents,
      folders: result.folders,
      documentsHasMore: result.documentsHasMore,
    })),
  });
}

async function ws_getLibraryFilterOptions(
  db: Db,
  userId: string,
  kind: LibraryKind,
  workspace: WorkspaceFilter = null,
): Promise<ServiceResult<{ fileTypes: string[] }>> {
  const { data, error } = await db.rpc("get_library_filter_options", {
    p_user_id: userId,
    p_library_kind: kind,
    ...workspaceRpcArg(workspace),
  });
  if (error) return ws_internalErr(error);
  const row = (data?.[0] ?? {}) as { file_types?: unknown };
  return ws_ok({
    fileTypes: Array.isArray(row.file_types)
      ? row.file_types.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  });
}

async function ws_getLibraryDocumentIds(
  db: Db,
  userId: string,
  kind: LibraryKind,
  searchTerm: string | null,
  fileType: string | null,
  workspace: WorkspaceFilter = null,
): Promise<ServiceResult<string[]>> {
  const ids: string[] = [];
  let offset = 0;
  for (let page = 0; page < LIBRARY_IDS_MAX_PAGES; page++) {
    const { data, error } = await db.rpc("get_library_document_ids", {
      p_user_id: userId,
      p_library_kind: kind,
      p_search_term: searchTerm,
      p_file_type: fileType,
      p_limit: LIBRARY_IDS_PAGE_SIZE,
      p_offset: offset,
      ...workspaceRpcArg(workspace),
    });
    if (error) return ws_internalErr(error);
    const rows = (data ?? []) as { id: string }[];
    if (rows.length === 0) break;
    ids.push(...rows.map((row) => row.id));
    offset += rows.length;
  }
  return ws_ok(ids);
}

async function ws_bulkDeleteLibraryDocuments(
  db: Db,
  userId: string,
  kind: LibraryKind,
  ids: string[],
): Promise<ServiceResult<{ deletedIds: string[] }>> {
  const deletedIds: string[] = [];
  for (
    let offset = 0;
    offset < ids.length;
    offset += LIBRARY_BULK_DELETE_BATCH_SIZE
  ) {
    const batch = ids.slice(offset, offset + LIBRARY_BULK_DELETE_BATCH_SIZE);
    const result = await deleteLibraryDocumentsAndVersionFiles(
      db,
      userId,
      kind,
      batch,
    );
    if (result.error) return ws_internalErr(result.error);
    deletedIds.push(...result.deletedIds);
  }
  return ws_ok({ deletedIds });
}

async function ws_getLibraryFolderPath(
  db: Db,
  userId: string,
  kind: LibraryKind,
  folderId: string,
  workspace: WorkspaceFilter = null,
): Promise<ServiceResult<{ folders: unknown[] }>> {
  // Walk up from the folder, one round trip per level, instead of loading
  // every library folder of this kind to follow one chain — an unpaged read
  // that also stopped at max_rows, answering 404 for folders past it.
  type FolderRow = Record<string, unknown> & { id: string; parent_folder_id?: string | null };
  let folders: FolderRow[];
  try {
    folders = await walkFolderGraph<FolderRow>(
      [folderId],
      async (ids) => {
        const { data, error } = await inWorkspace(
          db
            .from("library_folders")
            .select("*")
            .eq("user_id", userId)
            .eq("library_kind", kind)
            .in("id", ids),
          workspace,
        );
        if (error) throw error;
        return (data ?? []) as FolderRow[];
      },
      (folder) => [folder.parent_folder_id ?? null],
    );
  } catch (error) {
    return ws_internalErr(error);
  }
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const path: FolderRow[] = [];
  const visited = new Set<string>();
  let current = foldersById.get(folderId);
  if (!current) return ws_err(404, "Folder not found");

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = current.parent_folder_id
      ? foldersById.get(current.parent_folder_id)
      : undefined;
  }

  return ws_ok({ folders: path });
}

// Folder-tree upsert for uploads that carry a relative path (drag-and-drop of
// a whole directory): the RPC walks/creates each segment in one round trip so
// concurrent uploads of overlapping paths can't race each other into
// duplicate folders. `conflict_resolution` decides what an existing folder at
// a segment means — reuse it, create a renamed sibling, or fail.
async function ws_resolveLibraryFolderPath(
  db: Db,
  userId: string,
  kind: LibraryKind,
  body: {
    base_folder_id?: string | null;
    segments?: unknown;
    conflict_resolution?: unknown;
  },
  workspace: WorkspaceFilter = null,
): Promise<ServiceResult<unknown>> {
  const path = parseFolderPath(body);
  if (!path) return ws_err(400, "Invalid folder path");
  const { segments, conflictResolution, baseFolderId } = path;

  // The path is walked, and any missing folder made, in one workspace: the
  // base folder's, or the one the caller is working in.
  let orgId = workspaceOrgId(workspace);
  if (baseFolderId) {
    const parent = await ws_loadLibraryFolder(
      db,
      userId,
      kind,
      baseFolderId,
      workspace,
    );
    if (!parent) return ws_err(404, "Parent folder not found");
    orgId = parent.org_id;
  }

  const { data, error } = await db.rpc("resolve_library_folder_path", {
    target_user_id: userId,
    target_library_kind: kind,
    base_folder_id: baseFolderId,
    path_segments: segments,
    conflict_resolution: conflictResolution,
    ...(orgId ? { target_org_id: orgId } : {}),
  });
  if (error) return ws_internalErr(error);
  return ws_ok(data);
}

/** Create a named library folder in the authorized parent or current workspace. */
async function ws_createLibraryFolder(
  db: Db,
  userId: string,
  kind: LibraryKind,
  body: { name?: unknown; parent_folder_id?: string | null },
  workspace: WorkspaceFilter = null,
): Promise<ServiceResult<unknown>> {
  const { name, parent_folder_id } = body;
  if (typeof name !== "string" || !name.trim()) return ws_err(400, "name is required");

  // A folder is in its parent's workspace; at the top level, the one the
  // caller is working in.
  let orgId = workspaceOrgId(workspace);
  if (parent_folder_id) {
    const parent = await ws_loadLibraryFolder(
      db,
      userId,
      kind,
      parent_folder_id,
      workspace,
    );
    if (!parent) return ws_err(404, "Parent folder not found");
    orgId = parent.org_id;
  }

  const { data, error } = await db
    .from("library_folders")
    .insert({
      user_id: userId,
      library_kind: kind,
      name: name.trim(),
      parent_folder_id: parent_folder_id ?? null,
      ...(orgId ? { org_id: orgId } : {}),
    })
    .select("*")
    .single();
  if (error) return ws_internalErr(error);
  return ws_ok(data);
}

/** Rename or move a library folder after checking its workspace and parent tree. */
async function ws_updateLibraryFolder(
  db: Db,
  userId: string,
  kind: LibraryKind,
  folderId: string,
  body: { name?: unknown; parent_folder_id?: string | null },
  workspace: WorkspaceFilter = null,
): Promise<ServiceResult<unknown>> {
  const folder = await ws_loadLibraryFolder(db, userId, kind, folderId, workspace);
  if (!folder) return ws_err(404, "Folder not found");

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if ("name" in body) {
    if (typeof body.name !== "string") return ws_err(400, "name must be a non-empty string");
    const trimmed = body.name.trim();
    if (!trimmed) return ws_err(400, "name is required");
    updates.name = trimmed;
  }
  if ("parent_folder_id" in body) {
    if (body.parent_folder_id) {
      const moveError = await validateFolderMove(
        folderId, body.parent_folder_id,
        (id) => ws_loadLibraryFolder(db, userId, kind, id),
      );
      if (moveError === "cycle")
        return ws_err(400, "Cannot move a folder into itself or a descendant");
      if (moveError) return ws_err(404, "Parent folder not found");
      // A folder stays in its workspace: a parent in another one is, to
      // this folder, not there.
      const parent = await ws_loadLibraryFolder(
        db,
        userId,
        kind,
        body.parent_folder_id,
      );
      if (!parent || parent.org_id !== folder.org_id)
        return ws_err(404, "Parent folder not found");
    }
    updates.parent_folder_id = body.parent_folder_id ?? null;
  }

  const { data, error } = await db
    .from("library_folders")
    .update(updates)
    .eq("id", folderId)
    .eq("user_id", userId)
    .eq("library_kind", kind)
    .select("*")
    .single();
  if (error || !data) return ws_err(404, "Folder not found");
  return ws_ok(data);
}

async function ws_deleteLibraryFolder(
  db: Db,
  userId: string,
  kind: LibraryKind,
  folderId: string,
  workspace: WorkspaceFilter = null,
): Promise<ServiceResult<null>> {
  const { data: root, error: rootError } = await inWorkspace(
    db
      .from("library_folders")
      .select("id")
      .eq("id", folderId)
      .eq("user_id", userId)
      .eq("library_kind", kind),
    workspace,
  ).maybeSingle();
  if (rootError) return ws_internalErr(rootError);
  if (!root) return ws_err(404, "Folder not found");

  // Walk down from the folder (same user, kind and workspace scope as the
  // old full read of every library folder), then read and delete the
  // subtree's documents in full, batch by batch: an unpaged read stopped at
  // max_rows and the remainder silently moved to the library root.
  let docIds: string[];
  try {
    const { documents: docs } = await readFolderSubtree<{ id: string }>({
      label: "library folder subtree",
      rootId: folderId,
      childrenOf: (parents) =>
        inWorkspace(
          db
            .from("library_folders")
            .select("id")
            .eq("user_id", userId)
            .eq("library_kind", kind)
            .in("parent_folder_id", parents),
          workspace,
        ),
      documentsIn: (folders) => {
        const query = db
          .from("documents")
          .select("id")
          .eq("user_id", userId)
          .is("project_id", null)
          .in("library_folder_id", folders);
        return kind === "file"
          ? query.or("library_kind.eq.file,library_kind.is.null")
          : query.eq("library_kind", kind);
      },
    });
    docIds = docs.map((doc) => doc.id);
  } catch (error) {
    return ws_internalErr(error);
  }

  for (const batch of chunkArray(docIds, ID_FILTER_BATCH_SIZE)) {
    const deleteDocsResult = await deleteLibraryDocumentsAndVersionFiles(
      db,
      userId,
      kind,
      batch,
    );
    if (deleteDocsResult.error) return ws_internalErr(deleteDocsResult.error);
  }

  const { error } = await db
    .from("library_folders")
    .delete()
    .eq("id", folderId)
    .eq("user_id", userId)
    .eq("library_kind", kind);
  if (error) return ws_internalErr(error);
  return ws_ok(null);
}

async function ws_moveLibraryDocument(
  db: Db,
  userId: string,
  kind: LibraryKind,
  documentId: string,
  folder_id: string | null,
  workspace: WorkspaceFilter = null,
): Promise<ServiceResult<unknown>> {
  let folder: LibraryFolderRef | null = null;
  if (folder_id) {
    folder = await ws_loadLibraryFolder(db, userId, kind, folder_id, workspace);
    if (!folder) return ws_err(404, "Folder not found");
  }

  let moveQuery = inWorkspace(
    db
      .from("documents")
      .update({
        library_folder_id: folder_id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .eq("user_id", userId)
      .is("project_id", null),
    workspace,
  );
  // Into a folder: only a document of that folder's workspace. One from
  // another workspace matches nothing, and is reported as not found.
  if (folder) moveQuery = inOrg(moveQuery, folder.org_id);
  moveQuery =
    kind === "file"
      ? moveQuery.or("library_kind.eq.file,library_kind.is.null")
      : moveQuery.eq("library_kind", kind);
  const { data, error } = await moveQuery
    .select("*")
    .single();
  if (error || !data) return ws_err(404, "Document not found");
  return ws_ok(ws_mapLibraryDocument(data));
}

async function ws_renameLibraryDocument(
  db: Db,
  userId: string,
  kind: LibraryKind,
  documentId: string,
  rawFilename: unknown,
): Promise<ServiceResult<unknown>> {
  const result = await renameDocument(db, {
    userId,
    documentId,
    filename: rawFilename,
    scope: { kind: "library", libraryKind: kind },
  });
  if (result.ok) return ws_ok(ws_mapLibraryDocument(result.data));
  if (result.kind === "error") return ws_internalErr(result.error);
  return ws_err(result.kind === "validation" ? 400 : 404, result.detail);
}

// --- Organisation library shelves ---

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

function shelf_mapLibraryDocument(
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

async function shelf_loadLibraryFolder(
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
  query: any,
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
  query: any,
  actor: LibraryActor,
  kind: LibraryKind,
  orgId: string | null,
) {
  let next = query.eq("library_kind", kind);
  if (orgId) return next.eq("org_id", orgId);
  return next.eq("user_id", actor.userId).is("org_id", null);
}

const shelf_ok = <T>(data: T): ServiceOk<T> => ({ ok: true, data });
const shelf_err = (status: number, detail: string): ServiceErr => ({
  ok: false,
  failure: "status",
  status,
  detail,
});
const shelf_internalErr = (error: unknown): ServiceErr => ({
  ok: false,
  failure: "internal",
  error,
});

function writeDenied(): ServiceErr {
  return shelf_err(403, "You do not have permission to change this library.");
}

function libraryMeta(actor: LibraryActor) {
  return { sources: actor.sources.map(serializeSource) };
}

async function shelf_loadLibraryLevel(
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
  const docsTyped = pageDocs.map((doc: Record<string, unknown>) =>
    shelf_mapLibraryDocument(actor, doc),
  ) as { id: string; current_version_id?: string | null }[];
  await attachLatestVersionNumbers(db, docsTyped);
  await attachActiveVersionPaths(db, docsTyped);
  return {
    error: null,
    documents: docsTyped,
    folders: (folders ?? []).map((folder: Record<string, unknown>) =>
      decorateFolder(actor, folder),
    ),
    documentsHasMore,
  };
}

function unionRootFolders(actor: LibraryActor, kind: LibraryKind) {
  return actor.sources.map((source) => virtualSourceFolder(actor, source, kind));
}

async function shelf_getLibrary(
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
    return shelf_ok({
      documents: [],
      folders: unionRootFolders(actor, kind),
      documentsHasMore: false,
      ...libraryMeta(actor),
    });
  }

  let orgId: string | null = null;
  let realParentId: string | null = parentFolderId;
  if (parentFolderId) {
    const folder = await shelf_loadLibraryFolder(db, actor, kind, parentFolderId);
    if (!folder) return shelf_err(404, "Folder not found");
    orgId = folder.org_id;
    realParentId = folder.virtual ? null : folder.id;
  }

  const result = await shelf_loadLibraryLevel(
    db,
    actor,
    kind,
    realParentId,
    orgId,
    pagination,
  );
  if (result.error) return shelf_err(500, result.error);
  return shelf_ok({
    documents: result.documents,
    folders: result.folders,
    documentsHasMore: result.documentsHasMore,
    ...libraryMeta(actor),
  });
}

async function shelf_searchLibraryDocuments(
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
  if (error) return shelf_internalErr(error);

  const rows = (data ?? []) as Record<string, unknown>[];
  return shelf_ok({
    documents: rows
      .slice(0, pagination.limit)
      .map((row) => shelf_mapLibraryDocument(actor, row)),
    documentsHasMore: rows.length > pagination.limit,
    ...libraryMeta(actor),
  });
}

export const LIBRARY_CHAT_SEARCH_LIMIT = 8;

export type LibraryChatHit = {
  id: string;
  filename: string;
  file_type: string;
  storage_path: string;
  library_kind: LibraryKind;
  source_label: string;
  folder_path: string;
  current_version_id: string | null;
  active_version_number: number | null;
};

function asLibraryKind(value: unknown): LibraryKind {
  return value === "template" ? "template" : "file";
}

export async function searchLibraryForChat(
  db: Db,
  userId: string,
  args: { query: string; kind?: LibraryKind },
): Promise<ServiceResult<{ hits: LibraryChatHit[] }>> {
  const query = args.query.trim();
  if (!query) return shelf_err(400, "query is required");
  const kind = args.kind ?? "template";
  const actor = await resolveLibraryActor(db, userId);
  const result = await shelf_searchLibraryDocuments(
    db,
    actor,
    kind,
    query,
    null,
    { key: "name", direction: "asc" },
    { limit: LIBRARY_CHAT_SEARCH_LIMIT, offset: 0 },
  );
  if (!result.ok) return result;

  const documents = result.data.documents as Record<string, unknown>[];
  const folderIds = [
    ...new Set(
      documents
        .map((doc) => doc.library_folder_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const folderNameById = new Map<string, string>();
  if (folderIds.length > 0) {
    const { data: folders, error } = await db
      .from("library_folders")
      .select("id, name")
      .in("id", folderIds);
    if (error) return shelf_internalErr(error);
    for (const folder of (folders ?? []) as { id?: string; name?: string }[]) {
      if (folder.id && folder.name?.trim()) {
        folderNameById.set(folder.id, folder.name.trim());
      }
    }
  }

  const hits: LibraryChatHit[] = [];
  for (const doc of documents) {
    const storagePath =
      typeof doc.storage_path === "string" ? doc.storage_path : "";
    if (!storagePath || typeof doc.id !== "string") continue;
    const sourceLabel =
      typeof doc.source_label === "string" && doc.source_label.trim()
        ? doc.source_label.trim()
        : "Library";
    const folderName =
      typeof doc.library_folder_id === "string"
        ? folderNameById.get(doc.library_folder_id)
        : undefined;
    hits.push({
      id: doc.id,
      filename:
        typeof doc.filename === "string" && doc.filename.trim()
          ? doc.filename.trim()
          : "Untitled document",
      file_type: typeof doc.file_type === "string" ? doc.file_type : "",
      storage_path: storagePath,
      library_kind: asLibraryKind(doc.library_kind),
      source_label: sourceLabel,
      folder_path: folderName ? `${sourceLabel} / ${folderName}` : sourceLabel,
      current_version_id:
        typeof doc.current_version_id === "string"
          ? doc.current_version_id
          : null,
      active_version_number:
        typeof doc.active_version_number === "number"
          ? doc.active_version_number
          : null,
    });
  }
  return shelf_ok({ hits });
}

async function shelf_getLibraryLevels(
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
    result: Awaited<ReturnType<typeof shelf_loadLibraryLevel>> & {
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
          const folder = await shelf_loadLibraryFolder(db, actor, kind, level.parentId);
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
          result: await shelf_loadLibraryLevel(db, actor, kind, realParentId, orgId, {
            limit: level.limit,
            offset: 0,
          }),
        };
      }
    }),
  );
  const missing = results.find(({ result }) => result.error === "Folder not found");
  if (missing) return shelf_err(404, "Folder not found");
  const failed = results.find(({ result }) => result.error);
  if (failed?.result.error) return shelf_err(500, failed.result.error);
  return shelf_ok({
    levels: results.map(({ parentId, result }) => ({
      parentId,
      documents: result.documents,
      folders: result.folders,
      documentsHasMore: result.documentsHasMore,
    })),
    ...libraryMeta(actor),
  });
}

async function shelf_getLibraryFilterOptions(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
): Promise<ServiceResult<{ fileTypes: string[]; sources: ReturnType<typeof serializeSource>[] }>> {
  const { data, error } = await db.rpc("get_library_filter_options", {
    p_user_id: actor.userId,
    p_library_kind: kind,
    p_org_ids: actor.sources.flatMap((source) => (source.id ? [source.id] : [])),
  });
  if (error) return shelf_internalErr(error);
  const row = (data?.[0] ?? {}) as { file_types?: unknown };
  return shelf_ok({
    fileTypes: Array.isArray(row.file_types)
      ? row.file_types.filter((value): value is string => typeof value === "string")
      : [],
    ...libraryMeta(actor),
  });
}

async function shelf_getLibraryDocumentIds(
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
    if (error) return shelf_internalErr(error);
    const rows = (data ?? []) as { id: string }[];
    if (rows.length === 0) break;
    ids.push(...rows.map((row) => row.id));
    offset += rows.length;
  }
  return shelf_ok(ids);
}

async function shelf_bulkDeleteLibraryDocuments(
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
        ? shelf_internalErr(result.error)
        : shelf_err(500, result.detail);
    }
    deletedIds.push(...result.data.deletedIds);
  }
  return shelf_ok({ deletedIds });
}

async function shelf_getLibraryFolderPath(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  folderId: string,
): Promise<ServiceResult<{ folders: unknown[]; sources: ReturnType<typeof serializeSource>[] }>> {
  if (isLibrarySourceFolderId(folderId)) {
    const orgId = parseLibrarySourceKey(folderId);
    if (orgId === undefined) return shelf_err(404, "Folder not found");
    const source = librarySourceFor(actor, orgId);
    if (!source) return shelf_err(404, "Folder not found");
    return shelf_ok({
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
  if (personalResult.error) return shelf_internalErr(personalResult.error);
  if (orgResult.error) return shelf_internalErr(orgResult.error);
  const folders = [...(personalResult.data ?? []), ...(orgResult.data ?? [])];
  const foldersById = new Map(folders.map((folder) => [folder.id as string, folder]));
  const path: typeof folders = [];
  const visited = new Set<string>();
  let current = foldersById.get(folderId);
  if (!current) return shelf_err(404, "Folder not found");

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

  return shelf_ok({ folders: path, ...libraryMeta(actor) });
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
    if (parsed === undefined) return shelf_err(404, "Folder not found");
    orgId = parsed;
    folderId = null;
  } else if (folderId) {
    const folder = await shelf_loadLibraryFolder(db, actor, kind, folderId);
    if (!folder || folder.virtual) return shelf_err(404, "Folder not found");
    orgId = folder.org_id;
  } else if (body.org_id !== undefined) {
    const parsed = parseLibrarySourceKey(
      body.org_id === null ? PERSONAL_SOURCE_KEY : body.org_id,
    );
    if (parsed === undefined) return shelf_err(400, "Invalid library source");
    orgId = parsed;
  }
  if (!librarySourceFor(actor, orgId)) return shelf_err(404, "Library not found");
  if (!canWriteSource(actor, orgId)) return writeDenied();
  return shelf_ok({ orgId, folderId });
}

async function shelf_resolveLibraryFolderPath(
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
  if (!path) return shelf_err(400, "Invalid folder path");
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
  if (error) return shelf_internalErr(error);
  return shelf_ok(data);
}

async function shelf_createLibraryFolder(
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
  if (!name) return shelf_err(400, "name is required");
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
  if (error) return shelf_internalErr(error);
  return shelf_ok(decorateFolder(actor, data as Record<string, unknown>));
}

async function shelf_updateLibraryFolder(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  folderId: string,
  body: { name?: string; parent_folder_id?: string | null },
): Promise<ServiceResult<unknown>> {
  const folder = await shelf_loadLibraryFolder(db, actor, kind, folderId);
  if (!folder || folder.virtual) return shelf_err(404, "Folder not found");
  if (!canWriteSource(actor, folder.org_id)) return writeDenied();

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.name != null) {
    const trimmed = body.name.trim();
    if (!trimmed) return shelf_err(400, "name is required");
    updates.name = trimmed;
  }
  if ("parent_folder_id" in body) {
    if (body.parent_folder_id) {
      if (isLibrarySourceFolderId(body.parent_folder_id)) {
        const destOrg = parseLibrarySourceKey(body.parent_folder_id);
        if (destOrg === undefined) return shelf_err(404, "Parent folder not found");
        if (destOrg !== folder.org_id) {
          return shelf_err(400, "Cannot move a folder into a different library");
        }
        updates.parent_folder_id = null;
      } else {
        const moveError = await validateFolderMove(
          folderId,
          body.parent_folder_id,
          (id) => shelf_loadLibraryFolder(db, actor, kind, id),
        );
        if (moveError === "cycle")
          return shelf_err(400, "Cannot move a folder into itself or a descendant");
        if (moveError) return shelf_err(404, "Parent folder not found");
        const dest = await shelf_loadLibraryFolder(db, actor, kind, body.parent_folder_id);
        if (!dest) return shelf_err(404, "Parent folder not found");
        if (dest.org_id !== folder.org_id) {
          return shelf_err(400, "Cannot move a folder into a different library");
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
  if (error || !data) return shelf_err(404, "Folder not found");
  return shelf_ok(decorateFolder(actor, data as Record<string, unknown>));
}

async function shelf_deleteLibraryFolder(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  folderId: string,
): Promise<ServiceResult<null>> {
  const folder = await shelf_loadLibraryFolder(db, actor, kind, folderId);
  if (!folder || folder.virtual) return shelf_err(404, "Folder not found");
  if (!canWriteSource(actor, folder.org_id)) return writeDenied();

  const { data: allFolders, error: foldersError } = await applyFolderShelf(
    db.from("library_folders").select("id, parent_folder_id"),
    actor,
    kind,
    folder.org_id,
  );
  if (foldersError) return shelf_internalErr(foldersError);
  if (!(allFolders ?? []).some((row: { id: string }) => row.id === folderId)) {
    return shelf_err(404, "Folder not found");
  }

  const folderIds = collectFolderSubtree(folderId, allFolders ?? []);
  const { data: docs, error: docsError } = await applyDocumentShelf(
    db.from("documents").select("id"),
    actor,
    kind,
    folder.org_id,
  ).in("library_folder_id", [...folderIds]);
  if (docsError) return shelf_internalErr(docsError);

  const docIds = (docs ?? []).map((doc: { id: string }) => doc.id);
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
      ? shelf_internalErr(deleteDocsResult.error)
      : shelf_err(500, deleteDocsResult.detail);
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
  if (error) return shelf_internalErr(error);
  return shelf_ok(null);
}

async function shelf_moveLibraryDocument(
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
  if (existingError) return shelf_internalErr(existingError);
  const doc = existing as {
    id: string;
    org_id?: string | null;
    user_id?: string | null;
  } | null;
  if (!doc) return shelf_err(404, "Document not found");
  const orgId = doc.org_id ?? null;
  if (!librarySourceFor(actor, orgId)) return shelf_err(404, "Document not found");
  if (!orgId && doc.user_id !== actor.userId) return shelf_err(404, "Document not found");
  if (!canWriteSource(actor, orgId)) return writeDenied();

  let destFolderId: string | null = folder_id;
  if (folder_id) {
    const folder = await shelf_loadLibraryFolder(db, actor, kind, folder_id);
    if (!folder) return shelf_err(404, "Folder not found");
    if (folder.org_id !== orgId) {
      return shelf_err(400, "Cannot move a document into a different library");
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
  if (error || !data) return shelf_err(404, "Document not found");
  return shelf_ok(shelf_mapLibraryDocument(actor, data as Record<string, unknown>));
}

async function shelf_renameLibraryDocument(
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
  if (existingError) return shelf_internalErr(existingError);
  const doc = existing as {
    id: string;
    org_id?: string | null;
    user_id?: string | null;
  } | null;
  if (!doc) return shelf_err(404, "Document not found");
  const orgId = doc.org_id ?? null;
  if (!librarySourceFor(actor, orgId)) return shelf_err(404, "Document not found");
  if (!orgId && doc.user_id !== actor.userId) return shelf_err(404, "Document not found");
  if (!canWriteSource(actor, orgId)) return writeDenied();

  const result = await renameDocument(db, {
    userId: actor.userId,
    documentId,
    filename: rawFilename,
    scope: { kind: "library", libraryKind: kind, orgId },
  });
  if (result.ok) return shelf_ok(shelf_mapLibraryDocument(actor, result.data));
  if (result.kind === "error") return shelf_internalErr(result.error);
  return shelf_err(result.kind === "validation" ? 400 : 404, result.detail);
}


function isLibraryActor(value: string | LibraryActor): value is LibraryActor {
  return typeof value === "object" && value !== null && "sources" in value;
}

export function getLibrary(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  parentFolderId: string | null,
  pagination: PaginationParams,
): ReturnType<typeof shelf_getLibrary>;
export function getLibrary(
  db: Db,
  userId: string,
  kind: LibraryKind,
  parentFolderId: string | null,
  pagination: PaginationParams,
  workspace?: WorkspaceFilter,
): ReturnType<typeof ws_getLibrary>;
export function getLibrary(
  db: Db,
  userOrActor: string | LibraryActor,
  kind: LibraryKind,
  parentFolderId: string | null,
  pagination: PaginationParams,
  workspace: WorkspaceFilter = null,
) {
  if (isLibraryActor(userOrActor)) {
    return shelf_getLibrary(db, userOrActor, kind, parentFolderId, pagination);
  }
  return ws_getLibrary(db, userOrActor, kind, parentFolderId, pagination, workspace);
}

export function searchLibraryDocuments(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  searchTerm: string | null,
  fileType: string | null,
  sort: { key: string; direction: "asc" | "desc" },
  pagination: PaginationParams,
): ReturnType<typeof shelf_searchLibraryDocuments>;
export function searchLibraryDocuments(
  db: Db,
  userId: string,
  kind: LibraryKind,
  searchTerm: string | null,
  fileType: string | null,
  sort: { key: string; direction: "asc" | "desc" },
  pagination: PaginationParams,
  workspace?: WorkspaceFilter,
): ReturnType<typeof ws_searchLibraryDocuments>;
export function searchLibraryDocuments(
  db: Db,
  userOrActor: string | LibraryActor,
  kind: LibraryKind,
  searchTerm: string | null,
  fileType: string | null,
  sort: { key: string; direction: "asc" | "desc" },
  pagination: PaginationParams,
  workspace: WorkspaceFilter = null,
) {
  if (isLibraryActor(userOrActor)) {
    return shelf_searchLibraryDocuments(
      db, userOrActor, kind, searchTerm, fileType, sort, pagination,
    );
  }
  return ws_searchLibraryDocuments(
    db, userOrActor, kind, searchTerm, fileType, sort, pagination, workspace,
  );
}

export function getLibraryLevels(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  levels: Array<{ parentId: string | null; limit: number }>,
): ReturnType<typeof shelf_getLibraryLevels>;
export function getLibraryLevels(
  db: Db,
  userId: string,
  kind: LibraryKind,
  levels: Array<{ parentId: string | null; limit: number }>,
  workspace?: WorkspaceFilter,
): ReturnType<typeof ws_getLibraryLevels>;
export function getLibraryLevels(
  db: Db,
  userOrActor: string | LibraryActor,
  kind: LibraryKind,
  levels: Array<{ parentId: string | null; limit: number }>,
  workspace: WorkspaceFilter = null,
) {
  if (isLibraryActor(userOrActor)) {
    return shelf_getLibraryLevels(db, userOrActor, kind, levels);
  }
  return ws_getLibraryLevels(db, userOrActor, kind, levels, workspace);
}

export function getLibraryFilterOptions(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
): ReturnType<typeof shelf_getLibraryFilterOptions>;
export function getLibraryFilterOptions(
  db: Db,
  userId: string,
  kind: LibraryKind,
  workspace?: WorkspaceFilter,
): ReturnType<typeof ws_getLibraryFilterOptions>;
export function getLibraryFilterOptions(
  db: Db,
  userOrActor: string | LibraryActor,
  kind: LibraryKind,
  workspace: WorkspaceFilter = null,
) {
  if (isLibraryActor(userOrActor)) {
    return shelf_getLibraryFilterOptions(db, userOrActor, kind);
  }
  return ws_getLibraryFilterOptions(db, userOrActor, kind, workspace);
}

export function getLibraryDocumentIds(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  searchTerm: string | null,
  fileType: string | null,
): ReturnType<typeof shelf_getLibraryDocumentIds>;
export function getLibraryDocumentIds(
  db: Db,
  userId: string,
  kind: LibraryKind,
  searchTerm: string | null,
  fileType: string | null,
  workspace?: WorkspaceFilter,
): ReturnType<typeof ws_getLibraryDocumentIds>;
export function getLibraryDocumentIds(
  db: Db,
  userOrActor: string | LibraryActor,
  kind: LibraryKind,
  searchTerm: string | null,
  fileType: string | null,
  workspace: WorkspaceFilter = null,
) {
  if (isLibraryActor(userOrActor)) {
    return shelf_getLibraryDocumentIds(db, userOrActor, kind, searchTerm, fileType);
  }
  return ws_getLibraryDocumentIds(
    db, userOrActor, kind, searchTerm, fileType, workspace,
  );
}

export function bulkDeleteLibraryDocuments(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  ids: string[],
): ReturnType<typeof shelf_bulkDeleteLibraryDocuments>;
export function bulkDeleteLibraryDocuments(
  db: Db,
  userId: string,
  kind: LibraryKind,
  ids: string[],
): ReturnType<typeof ws_bulkDeleteLibraryDocuments>;
export function bulkDeleteLibraryDocuments(
  db: Db,
  userOrActor: string | LibraryActor,
  kind: LibraryKind,
  ids: string[],
) {
  if (isLibraryActor(userOrActor)) {
    return shelf_bulkDeleteLibraryDocuments(db, userOrActor, kind, ids);
  }
  return ws_bulkDeleteLibraryDocuments(db, userOrActor, kind, ids);
}

export function getLibraryFolderPath(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  folderId: string,
): ReturnType<typeof shelf_getLibraryFolderPath>;
export function getLibraryFolderPath(
  db: Db,
  userId: string,
  kind: LibraryKind,
  folderId: string,
  workspace?: WorkspaceFilter,
): ReturnType<typeof ws_getLibraryFolderPath>;
export function getLibraryFolderPath(
  db: Db,
  userOrActor: string | LibraryActor,
  kind: LibraryKind,
  folderId: string,
  workspace: WorkspaceFilter = null,
) {
  if (isLibraryActor(userOrActor)) {
    return shelf_getLibraryFolderPath(db, userOrActor, kind, folderId);
  }
  return ws_getLibraryFolderPath(db, userOrActor, kind, folderId, workspace);
}

export function resolveLibraryFolderPath(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  body: {
    base_folder_id?: string | null;
    org_id?: string | null;
    segments?: unknown;
    conflict_resolution?: unknown;
  },
): ReturnType<typeof shelf_resolveLibraryFolderPath>;
export function resolveLibraryFolderPath(
  db: Db,
  userId: string,
  kind: LibraryKind,
  body: {
    base_folder_id?: string | null;
    segments?: unknown;
    conflict_resolution?: unknown;
  },
  workspace?: WorkspaceFilter,
): ReturnType<typeof ws_resolveLibraryFolderPath>;
export function resolveLibraryFolderPath(
  db: Db,
  userOrActor: string | LibraryActor,
  kind: LibraryKind,
  body: {
    base_folder_id?: string | null;
    org_id?: string | null;
    segments?: unknown;
    conflict_resolution?: unknown;
  },
  workspace: WorkspaceFilter = null,
) {
  if (isLibraryActor(userOrActor)) {
    return shelf_resolveLibraryFolderPath(db, userOrActor, kind, body);
  }
  return ws_resolveLibraryFolderPath(db, userOrActor, kind, body, workspace);
}

export function createLibraryFolder(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  body: { name?: unknown; parent_folder_id?: string | null; org_id?: string | null },
): ReturnType<typeof shelf_createLibraryFolder>;
export function createLibraryFolder(
  db: Db,
  userId: string,
  kind: LibraryKind,
  body: { name?: unknown; parent_folder_id?: string | null },
  workspace?: WorkspaceFilter,
): ReturnType<typeof ws_createLibraryFolder>;
export function createLibraryFolder(
  db: Db,
  userOrActor: string | LibraryActor,
  kind: LibraryKind,
  body: { name?: unknown; parent_folder_id?: string | null; org_id?: string | null },
  workspace: WorkspaceFilter = null,
) {
  if (isLibraryActor(userOrActor)) {
    return shelf_createLibraryFolder(db, userOrActor, kind, body);
  }
  return ws_createLibraryFolder(db, userOrActor, kind, body, workspace);
}

export function updateLibraryFolder(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  folderId: string,
  body: { name?: unknown; parent_folder_id?: string | null },
): ReturnType<typeof shelf_updateLibraryFolder>;
export function updateLibraryFolder(
  db: Db,
  userId: string,
  kind: LibraryKind,
  folderId: string,
  body: { name?: unknown; parent_folder_id?: string | null },
  workspace?: WorkspaceFilter,
): ReturnType<typeof ws_updateLibraryFolder>;
export function updateLibraryFolder(
  db: Db,
  userOrActor: string | LibraryActor,
  kind: LibraryKind,
  folderId: string,
  body: { name?: unknown; parent_folder_id?: string | null },
  workspace: WorkspaceFilter = null,
) {
  if (isLibraryActor(userOrActor)) {
    return shelf_updateLibraryFolder(db, userOrActor, kind, folderId, body);
  }
  return ws_updateLibraryFolder(db, userOrActor, kind, folderId, body, workspace);
}

export function deleteLibraryFolder(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  folderId: string,
): ReturnType<typeof shelf_deleteLibraryFolder>;
export function deleteLibraryFolder(
  db: Db,
  userId: string,
  kind: LibraryKind,
  folderId: string,
  workspace?: WorkspaceFilter,
): ReturnType<typeof ws_deleteLibraryFolder>;
export function deleteLibraryFolder(
  db: Db,
  userOrActor: string | LibraryActor,
  kind: LibraryKind,
  folderId: string,
  workspace: WorkspaceFilter = null,
) {
  if (isLibraryActor(userOrActor)) {
    return shelf_deleteLibraryFolder(db, userOrActor, kind, folderId);
  }
  return ws_deleteLibraryFolder(db, userOrActor, kind, folderId, workspace);
}

export function moveLibraryDocument(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  documentId: string,
  folderId: string | null,
): ReturnType<typeof shelf_moveLibraryDocument>;
export function moveLibraryDocument(
  db: Db,
  userId: string,
  kind: LibraryKind,
  documentId: string,
  folderId: string | null,
  workspace?: WorkspaceFilter,
): ReturnType<typeof ws_moveLibraryDocument>;
export function moveLibraryDocument(
  db: Db,
  userOrActor: string | LibraryActor,
  kind: LibraryKind,
  documentId: string,
  folderId: string | null,
  workspace: WorkspaceFilter = null,
) {
  if (isLibraryActor(userOrActor)) {
    return shelf_moveLibraryDocument(db, userOrActor, kind, documentId, folderId);
  }
  return ws_moveLibraryDocument(
    db, userOrActor, kind, documentId, folderId, workspace,
  );
}

export function renameLibraryDocument(
  db: Db,
  actor: LibraryActor,
  kind: LibraryKind,
  documentId: string,
  rawFilename: unknown,
): ReturnType<typeof shelf_renameLibraryDocument>;
export function renameLibraryDocument(
  db: Db,
  userId: string,
  kind: LibraryKind,
  documentId: string,
  rawFilename: unknown,
): ReturnType<typeof ws_renameLibraryDocument>;
export function renameLibraryDocument(
  db: Db,
  userOrActor: string | LibraryActor,
  kind: LibraryKind,
  documentId: string,
  rawFilename: unknown,
) {
  if (isLibraryActor(userOrActor)) {
    return shelf_renameLibraryDocument(db, userOrActor, kind, documentId, rawFilename);
  }
  return ws_renameLibraryDocument(db, userOrActor, kind, documentId, rawFilename);
}
