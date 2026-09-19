// One uploaded file, several documents.
//
// Two upload types are containers for other documents: an email carries its
// attachments, and a zip carries a folder of files. This file turns those
// into ordinary documents in the same project, folder, or library the upload
// was aimed at, so the rest of the app never has to know they arrived
// packed.
//
// Everything here is idempotent by construction. The worker retries a failed
// job, so every child document and version id is derived from the upload
// file id and the child's path; a retry upserts the same rows and skips
// versions that already exist instead of filing duplicates.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import JSZip from "jszip";

import { createDocumentVersion } from "../documents/documents.service";
import { recordAudit } from "../../lib/audit";
import {
  ALLOWED_DOCUMENT_TYPES,
  contentTypeForDocumentType,
  documentSuffix,
  isArchiveDocumentType,
  isEmailDocumentType,
} from "../../lib/documentTypes";
import {
  fileableAttachments,
  parseEmail,
  type ParsedEmail,
} from "../../lib/emailMessage";
import { storageKey, uploadFileFromPath } from "../../lib/storage";
import type { Db } from "../../lib/supabase";
import { MAX_UPLOAD_SIZE_BYTES } from "./uploads.manifest";
import {
  buildEmailPdfRendition,
  buildPdfRendition,
  countPdfPages,
} from "./uploads.renditions";

/** Where the parent upload was aimed; children land in the same place. */
export type ExpansionTarget = {
  scope: "standalone" | "project" | "library" | "workflow";
  projectId: string | null;
  /** Project folder (or library folder) the parent landed in. */
  folderId: string | null;
  libraryKind: "file" | "template" | "workflow_asset";
  workflowId: string | null;
  orgId: string | null;
};

export type ExpansionContext = {
  db: Db;
  userId: string;
  userEmail: string | null;
  /** The upload_session_files row id: the namespace for derived child ids. */
  uploadFileId: string;
  workingDirectory: string;
  target: ExpansionTarget;
};

export type ExpandedDocument = {
  id: string;
  filename: string;
  file_type: string;
  folder_id: string | null;
};

/** Zip entries from macOS and Windows that are never documents. */
const IGNORED_ARCHIVE_PATHS = [/^__MACOSX\//i, /(^|\/)\.DS_Store$/i, /(^|\/)Thumbs\.db$/i, /(^|\/)\./];

/** Emails inside zips inside emails end here. */
const MAX_EXPANSION_DEPTH = 2;

/**
 * A UUID derived from the upload file and the child's path, so the same
 * child always gets the same id across retries. Formatted as a v5-style
 * UUID: the version and variant bits are set so Postgres accepts it.
 */
export function derivedDocumentId(namespace: string, key: string): string {
  const hash = createHash("sha1")
    .update(`${namespace}\u0000${key}`)
    .digest("hex")
    .slice(0, 32);
  const bytes = hash.split("");
  bytes[12] = "5";
  bytes[16] = ((parseInt(bytes[16]!, 16) & 0x3) | 0x8).toString(16);
  const uuid = bytes.join("");
  return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
}

function isAllowedChildType(fileType: string): boolean {
  return ALLOWED_DOCUMENT_TYPES.has(fileType);
}

/** Filenames cannot carry path separators or control characters in the manifest; hold children to the same rule. */
function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[\x00-\x1F\x7F/\\]/g, "_")
    .trim()
    .slice(0, 255);
  return cleaned || "attachment";
}

// ---------------------------------------------------------------------------
// Filing one child document
// ---------------------------------------------------------------------------

/**
 * Create a document (with its first version) from a file on local disk. This
 * is the same sequence processCreatedDocument follows for a directly
 * uploaded file, minus the sealed-object bookkeeping, which belongs to the
 * parent upload.
 */
export async function createDocumentFromLocalFile(
  context: ExpansionContext,
  child: {
    documentId: string;
    filename: string;
    fileType: string;
    filePath: string;
    sizeBytes: number;
    sha256: string;
    folderId: string | null;
    /** Rendition already produced (emails). Skips the Office converter. */
    pdfRendition?: { key: string; localPath: string } | null;
  },
): Promise<ExpandedDocument> {
  const { db, userId, target } = context;
  const { documentId } = child;
  const versionId = derivedDocumentId(documentId, "version:1");

  const { error: documentError } = await db.from("documents").upsert(
    {
      id: documentId,
      project_id: target.projectId,
      user_id: userId,
      status: "processing",
      org_id: target.orgId,
      folder_id: target.scope === "project" ? child.folderId : null,
      library_kind: target.libraryKind,
      library_folder_id: target.scope === "library" ? child.folderId : null,
      workflow_id: target.workflowId,
    },
    { onConflict: "id" },
  );
  if (documentError) throw documentError;

  const sourcePath = storageKey(userId, documentId, child.filename);
  await uploadFileFromPath(
    sourcePath,
    child.filePath,
    contentTypeForDocumentType(child.fileType),
  );

  let pdfPath: string | null;
  let pageCount: number | null = null;
  if (child.pdfRendition) {
    pdfPath = child.pdfRendition.key;
    pageCount = await countPdfPages(child.pdfRendition.localPath);
  } else {
    pdfPath = await buildPdfRendition({
      sourceFilePath: child.filePath,
      workingDirectory: context.workingDirectory,
      fileType: child.fileType,
      userId,
      documentId,
      sourceStoragePath: sourcePath,
    });
    if (child.fileType === "pdf") pageCount = await countPdfPages(child.filePath);
  }

  // A retry after the version landed must not fail on the duplicate id.
  const { data: existingVersion } = await db
    .from("document_versions")
    .select("id")
    .eq("id", versionId)
    .maybeSingle();
  if (!existingVersion) {
    const { error: versionError } = await createDocumentVersion(db, {
      id: versionId,
      document_id: documentId,
      storage_path: sourcePath,
      pdf_storage_path: pdfPath,
      source: "upload",
      version_number: 1,
      filename: child.filename,
      file_type: child.fileType,
      size_bytes: child.sizeBytes,
      page_count: pageCount,
      content_sha256: child.sha256,
    });
    if (versionError) throw versionError;
  }

  const { error: readyError } = await db
    .from("documents")
    .update({ status: "ready", updated_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("user_id", userId);
  if (readyError) throw readyError;

  await recordAudit(db, {
    userId,
    userEmail: context.userEmail,
    action: "document.uploaded",
    title: child.filename,
    surface: target.projectId ? "project" : "assistant",
    projectId: target.projectId,
    documentId,
  });

  return {
    id: documentId,
    filename: child.filename,
    file_type: child.fileType,
    folder_id: child.folderId,
  };
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

/**
 * File an email's attachments as documents next to it. Returns the filenames
 * that were imported so the message rendering can say which ones travelled
 * with it.
 */
export async function expandEmailAttachments(
  context: ExpansionContext,
  email: ParsedEmail,
  parent: { documentId: string; folderId: string | null },
  depth = 0,
): Promise<ExpandedDocument[]> {
  const created: ExpandedDocument[] = [];
  const attachments = fileableAttachments(email, isAllowedChildType);
  for (const [index, attachment] of attachments.entries()) {
    const filename = safeFilename(attachment.filename);
    const fileType = documentSuffix(filename);
    if (attachment.content.byteLength > MAX_UPLOAD_SIZE_BYTES) continue;
    const documentId = derivedDocumentId(
      context.uploadFileId,
      `${parent.documentId}:attachment:${index}:${filename}`,
    );
    const filePath = join(
      context.workingDirectory,
      `attachment-${documentId}.${fileType}`,
    );
    await writeFile(filePath, attachment.content);
    created.push(
      ...(await fileLocalDocument(context, {
        documentId,
        filename,
        fileType,
        filePath,
        sizeBytes: attachment.content.byteLength,
        sha256: createHash("sha256").update(attachment.content).digest("hex"),
        folderId: parent.folderId,
        depth: depth + 1,
      })),
    );
  }
  return created;
}

/**
 * File one local file, recursing into emails (attachments) and archives
 * (entries) up to MAX_EXPANSION_DEPTH. Returns every document created,
 * the file's own first when it is one.
 */
async function fileLocalDocument(
  context: ExpansionContext,
  child: {
    documentId: string;
    filename: string;
    fileType: string;
    filePath: string;
    sizeBytes: number;
    sha256: string;
    folderId: string | null;
    depth: number;
  },
): Promise<ExpandedDocument[]> {
  if (isArchiveDocumentType(child.fileType)) {
    if (child.depth >= MAX_EXPANSION_DEPTH) return [];
    return expandArchive(context, child.filePath, child.folderId, child.depth);
  }
  if (isEmailDocumentType(child.fileType)) {
    const email = await parseEmail(
      await readFile(child.filePath),
      child.fileType,
    );
    const attachments =
      child.depth >= MAX_EXPANSION_DEPTH
        ? []
        : await expandEmailAttachments(
            context,
            email,
            { documentId: child.documentId, folderId: child.folderId },
            child.depth,
          );
    const rendition = await buildEmailPdfRendition({
      email,
      importedAttachments: attachments.map((doc) => doc.filename),
      workingDirectory: context.workingDirectory,
      userId: context.userId,
      documentId: child.documentId,
    });
    const own = await createDocumentFromLocalFile(context, {
      ...child,
      pdfRendition: rendition,
    });
    return [own, ...attachments];
  }
  return [await createDocumentFromLocalFile(context, child)];
}

// ---------------------------------------------------------------------------
// Archives
// ---------------------------------------------------------------------------

async function resolveArchiveFolder(
  context: ExpansionContext,
  baseFolderId: string | null,
  segments: string[],
  cache: Map<string, Promise<string | null>>,
): Promise<string | null> {
  if (segments.length === 0) return baseFolderId;
  const { db, userId, target } = context;
  // Folders only exist for projects and libraries; other scopes flatten.
  if (target.scope !== "project" && target.scope !== "library") {
    return baseFolderId;
  }
  const cacheKey = JSON.stringify([baseFolderId, segments]);
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const pending = (async () => {
    const { data, error } =
      target.scope === "project"
        ? await db.rpc("resolve_project_folder_path", {
            target_project_id: target.projectId,
            target_user_id: userId,
            base_folder_id: baseFolderId,
            path_segments: segments,
            conflict_resolution: "reuse",
          })
        : await db.rpc("resolve_library_folder_path", {
            target_user_id: userId,
            target_library_kind: target.libraryKind,
            base_folder_id: baseFolderId,
            path_segments: segments,
            conflict_resolution: "reuse",
          });
    if (error) throw error;
    const result = data as { conflict?: boolean; folder_id?: string | null };
    if (result?.conflict) return baseFolderId;
    return result?.folder_id ?? baseFolderId;
  })();
  cache.set(cacheKey, pending);
  return pending;
}

/**
 * Unpack a zip into documents. Directory structure becomes folders under
 * the folder the zip was uploaded to; entries of unsupported types, hidden
 * files, and oversized files are skipped; nested zips and emails are
 * expanded one level down.
 */
export async function expandArchive(
  context: ExpansionContext,
  archivePath: string,
  baseFolderId: string | null,
  depth = 0,
): Promise<ExpandedDocument[]> {
  const zip = await JSZip.loadAsync(await readFile(archivePath));
  const created: ExpandedDocument[] = [];
  const folderCache = new Map<string, Promise<string | null>>();

  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const normalizedPath = entry.name.replace(/\\/g, "/").replace(/^\/+/, "");
    if (IGNORED_ARCHIVE_PATHS.some((pattern) => pattern.test(normalizedPath))) {
      continue;
    }
    const segments = normalizedPath.split("/").filter(Boolean);
    const rawName = segments.pop();
    if (!rawName) continue;
    const filename = safeFilename(rawName);
    const fileType = documentSuffix(filename);
    if (!isAllowedChildType(fileType)) continue;

    const content = await entry.async("nodebuffer");
    if (content.byteLength === 0 || content.byteLength > MAX_UPLOAD_SIZE_BYTES) {
      continue;
    }

    const documentId = derivedDocumentId(
      context.uploadFileId,
      `archive:${depth}:${normalizedPath}`,
    );
    const filePath = join(
      context.workingDirectory,
      `entry-${documentId}.${fileType}`,
    );
    await writeFile(filePath, content);
    const folderId = await resolveArchiveFolder(
      context,
      baseFolderId,
      segments,
      folderCache,
    );
    created.push(
      ...(await fileLocalDocument(context, {
        documentId,
        filename,
        fileType,
        filePath,
        sizeBytes: content.byteLength,
        sha256: createHash("sha256").update(content).digest("hex"),
        folderId,
        depth: depth + 1,
      })),
    );
  }
  return created;
}
