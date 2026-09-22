// Business logic for the integrations module: the Libris Colleague side of
// "pull a Zoho matter and keep it in sync with its SharePoint folder".
//
// Zoho and Microsoft Graph credentials stay inside the Attune filer (Libris
// Back Office). This service is a thin, authenticated client of the filer's
// single `POST /api/colleague` route: it checks that the caller belongs to the
// matter-sync organisation, forwards the action with the caller's email as
// `requestedBy`, and maps the filer's answers onto `ServiceResult`s. The
// filer's own error text never reaches the client; every failure kind carries
// a message written here.
//
// Design note: docs/integrations/sharepoint-zoho-matter-sync.md.

import { recordSharePointVersion } from "../documents/documents.service";
import { checkProjectAccess, getOrgRole } from "../../lib/access";
import { enqueueProjectMatterBrief } from "../memory/memory.service";
import {
  folderUrlFromSharepointDocumentUrl,
  normalizeHttpUrl,
} from "../../lib/httpUrl";
import { logError } from "../../lib/log";
import { filerConfiguration } from "../../lib/runtimeConfig";
import { getSignedUrl } from "../../lib/storage";
import {
  failure,
  internalFailure,
  ok,
  type ServiceResult,
} from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";

export type MatterSyncStatus =
  | "AwaitingFolder"
  | "Creating"
  | "Syncing"
  | "Idle"
  | "Failed"
  | "TimedOut"
  | "Paused";

export type ZohoMatterSearchHit = {
  id: string;
  matterNumber: string | null;
  name: string;
  account: string | null;
  status: string | null;
  hasFolder: boolean;
};

export type MatterPullResult = {
  projectId: string;
  created: boolean;
  matterNumber: string | null;
  matterName: string | null;
  account: string | null;
  description: string | null;
  uploaded: number;
  remaining: number;
  status: MatterSyncStatus;
  matterId: string | null;
  sharepointFolderUrl: string | null;
};

export type MatterSyncFileStage = "queued" | "uploaded" | "processing" | "error";

export type MatterSyncFile = {
  id: string;
  filename: string;
  folderId: string | null;
  stage: MatterSyncFileStage;
};

export type MatterSyncStatusResult =
  | { found: false }
  | {
      found: true;
      status: MatterSyncStatus;
      matterNumber: string | null;
      matterName: string | null;
      documentCount: number;
      remaining: number;
      lastSyncAt: string | null;
      lastChangeAt: string | null;
      lastError: string | null;
      matterId: string | null;
      sharepointFolderUrl: string | null;
      /** Files handed to Railway that are not ready documents yet. */
      files: MatterSyncFile[];
    };

const UNAVAILABLE_MESSAGE =
  "Pulling matters from Zoho is not set up on this deployment.";
const FORBIDDEN_MESSAGE =
  "Only members of the matter-sync organisation can pull matters from Zoho.";
const FILER_UNREACHABLE_MESSAGE =
  "The matter sync service did not respond. Please try again shortly.";
export const PROJECT_NOT_READY_MESSAGE =
  "The matter could not be created in Libris Colleague. Please try again shortly.";
export const FOLDER_NOT_READY_MESSAGE =
  "The SharePoint folder for this matter has not been created yet. It will sync automatically once it appears.";

const SEARCH_TIMEOUT_MS = 15_000;
const STATUS_TIMEOUT_MS = 15_000;
// The filer runs a bounded first pass inline before answering a pull.
const PULL_TIMEOUT_MS = 60_000;
const PUSH_TIMEOUT_MS = 60_000;

const STATUS_VALUES: ReadonlySet<string> = new Set<MatterSyncStatus>([
  "AwaitingFolder",
  "Creating",
  "Syncing",
  "Idle",
  "Failed",
  "TimedOut",
  "Paused",
]);

type FilerCall =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; reason: "unreachable" | "malformed"; error: unknown };

/**
 * One round trip to the filer. Network and parse failures are returned, not
 * thrown, so callers decide how to present them; the raw error goes to the
 * log only.
 */
async function callFiler(
  action: "search" | "pull" | "status" | "push",
  params: Record<string, unknown>,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<FilerCall> {
  const config = filerConfiguration();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${config.baseUrl}/api/colleague`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-functions-key": config.functionKey,
      },
      body: JSON.stringify({ action, ...params }),
      signal: controller.signal,
    });
    const text = await response.text();
    let body: Record<string, unknown> = {};
    if (text) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          body = parsed as Record<string, unknown>;
        }
      } catch (error) {
        // Never log the body: it may carry the filer's internal detail.
        logError("integrations/filer", "malformed response", {
          action,
          status: response.status,
          error: error instanceof Error ? error.message : String(error),
        });
        return { ok: false, reason: "malformed", error };
      }
    }
    return { ok: true, status: response.status, body };
  } catch (error) {
    logError("integrations/filer", "request failed", {
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "unreachable", error };
  } finally {
    clearTimeout(timer);
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function statusOf(value: unknown): MatterSyncStatus {
  return typeof value === "string" && STATUS_VALUES.has(value)
    ? (value as MatterSyncStatus)
    : "Syncing";
}

const ZOHO_DEAL_ID_MAX_LENGTH = 64;

function normalizeDealId(value: unknown): string | null {
  const id = stringOrNull(value)?.trim() ?? null;
  if (!id || id.length > ZOHO_DEAL_ID_MAX_LENGTH) return null;
  return id;
}

function filerDealId(body: Record<string, unknown>): string | null {
  return normalizeDealId(body.matterId) ?? normalizeDealId(body.dealId);
}

/**
 * Production filer builds before the link fields still answer status/pull
 * without a Deal id. Search by matter number is already live, so one extra
 * lookup fills Zoho for those rows.
 */
async function dealIdFromMatterNumber(
  matterNumber: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const call = await callFiler(
    "search",
    { q: matterNumber },
    SEARCH_TIMEOUT_MS,
    fetchImpl,
  );
  if (!call.ok || call.status !== 200) return null;
  const rows = Array.isArray(call.body.matters) ? call.body.matters : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const hit = row as Record<string, unknown>;
    if (stringOrNull(hit.matterNumber) !== matterNumber) continue;
    return normalizeDealId(hit.id);
  }
  return null;
}

async function sharepointFolderUrlFromDocuments(
  db: Db,
  projectId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("documents")
    .select("external_web_url")
    .eq("project_id", projectId)
    .limit(40);
  if (error || !data) return null;
  const counts = new Map<string, number>();
  for (const row of data) {
    const folder = folderUrlFromSharepointDocumentUrl(
      (row as { external_web_url?: unknown }).external_web_url,
    );
    if (!folder) continue;
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [url, count] of counts) {
    if (count > bestCount) {
      best = url;
      bestCount = count;
    }
  }
  return best;
}

type ProjectLinkRow = {
  cm_number?: unknown;
  zoho_deal_id?: unknown;
  sharepoint_folder_url?: unknown;
};

/**
 * Prefer the filer's identifiers, then whatever is already on the project,
 * then a Zoho search and a walk up from mirrored file URLs. Matters created
 * before these columns existed stay blank until one of those fills them.
 */
async function resolveMatterLinks(
  db: Db,
  projectId: string,
  fromFiler: { zohoDealId: string | null; sharepointFolderUrl: string | null },
  fetchImpl: typeof fetch,
  extras?: { matterNumber?: string | null },
): Promise<{ zohoDealId: string | null; sharepointFolderUrl: string | null }> {
  let project: ProjectLinkRow | null = null;
  try {
    const { data } = await db
      .from("projects")
      .select("cm_number, zoho_deal_id, sharepoint_folder_url")
      .eq("id", projectId)
      .maybeSingle();
    project = (data as ProjectLinkRow | null) ?? null;
  } catch (error) {
    logError("integrations/hydrate", error, { projectId });
  }

  let zohoDealId =
    fromFiler.zohoDealId || normalizeDealId(project?.zoho_deal_id);
  let sharepointFolderUrl =
    fromFiler.sharepointFolderUrl ||
    normalizeHttpUrl(project?.sharepoint_folder_url);

  if (!zohoDealId) {
    const matterNumber =
      extras?.matterNumber?.trim() || stringOrNull(project?.cm_number);
    if (matterNumber) {
      zohoDealId = await dealIdFromMatterNumber(matterNumber, fetchImpl);
    }
  }
  if (!sharepointFolderUrl) {
    try {
      sharepointFolderUrl = await sharepointFolderUrlFromDocuments(
        db,
        projectId,
      );
    } catch (error) {
      logError("integrations/hydrate", error, { projectId });
    }
  }
  return { zohoDealId, sharepointFolderUrl };
}

/**
 * Write Zoho / SharePoint identifiers onto the project. Pull replaces any
 * values the filer sent; status only fills blanks so opening a matter
 * backfills rows created before these columns existed. Failures stay
 * local: the pull or status answer must not depend on this write.
 */
async function persistMatterLinks(
  db: Db,
  projectId: string,
  fields: { zohoDealId: string | null; sharepointFolderUrl: string | null },
  mode: "replace" | "fill",
): Promise<void> {
  const zohoDealId = normalizeDealId(fields.zohoDealId);
  const sharepointFolderUrl = normalizeHttpUrl(fields.sharepointFolderUrl);
  if (!zohoDealId && !sharepointFolderUrl) return;
  try {
    if (mode === "fill") {
      const { data } = await db
        .from("projects")
        .select("zoho_deal_id, sharepoint_folder_url")
        .eq("id", projectId)
        .maybeSingle();
      const updates: Record<string, string> = {};
      if (zohoDealId && !stringOrNull(data?.zoho_deal_id)) {
        updates.zoho_deal_id = zohoDealId;
      }
      if (sharepointFolderUrl && !stringOrNull(data?.sharepoint_folder_url)) {
        updates.sharepoint_folder_url = sharepointFolderUrl;
      }
      if (Object.keys(updates).length === 0) return;
      await db
        .from("projects")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", projectId);
      return;
    }
    const updates: Record<string, string> = {};
    if (zohoDealId) updates.zoho_deal_id = zohoDealId;
    if (sharepointFolderUrl) updates.sharepoint_folder_url = sharepointFolderUrl;
    if (Object.keys(updates).length === 0) return;
    await db
      .from("projects")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", projectId);
  } catch (error) {
    logError("integrations/hydrate", error, { projectId });
  }
}

async function requireSyncMember(
  db: Db,
  userId: string,
): Promise<ServiceResult<{ orgId: string }>> {
  const config = filerConfiguration();
  if (!config.configured) return failure("unavailable", UNAVAILABLE_MESSAGE);
  const role = await getOrgRole(userId, config.matterSyncOrgId, db);
  if (!role) return failure("forbidden", FORBIDDEN_MESSAGE);
  return ok({ orgId: config.matterSyncOrgId });
}

/** Search Zoho matters by number, name or client through the filer. */
export async function searchZohoMatters(
  db: Db,
  args: { userId: string; q: unknown },
  fetchImpl: typeof fetch = fetch,
): Promise<ServiceResult<{ matters: ZohoMatterSearchHit[] }>> {
  const q = typeof args.q === "string" ? args.q.trim() : "";
  if (q.length < 2)
    return failure("validation", "Enter at least two characters to search.");
  if (q.length > 200) return failure("validation", "Search text is too long.");

  const member = await requireSyncMember(db, args.userId);
  if (!member.ok) return member;

  const call = await callFiler("search", { q }, SEARCH_TIMEOUT_MS, fetchImpl);
  if (!call.ok) return failure("unavailable", FILER_UNREACHABLE_MESSAGE);
  if (call.status === 400)
    return failure("validation", "That search could not be run.");
  if (call.status !== 200) return internalFailure(filerStatusError(call.status));

  const rows = Array.isArray(call.body.matters) ? call.body.matters : [];
  const matters = rows.flatMap((row): ZohoMatterSearchHit[] => {
    if (!row || typeof row !== "object") return [];
    const hit = row as Record<string, unknown>;
    const id = stringOrNull(hit.id);
    if (!id) return [];
    return [
      {
        id,
        matterNumber: stringOrNull(hit.matterNumber),
        name: stringOrNull(hit.name) ?? "(unnamed matter)",
        account: stringOrNull(hit.account),
        status: stringOrNull(hit.status),
        hasFolder: hit.hasFolder === true,
      },
    ];
  });
  return ok({ matters });
}

/**
 * Enrol a matter for sync and run the filer's bounded first pass. Accepts the
 * Zoho Deal id, or (for "Sync now" from an existing matter page) the matter
 * number the project already carries as `cm_number`.
 */
export async function pullZohoMatter(
  db: Db,
  args: {
    userId: string;
    userEmail: string | null | undefined;
    matterId?: unknown;
    matterNumber?: unknown;
    mode?: unknown;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<ServiceResult<MatterPullResult>> {
  const matterId =
    typeof args.matterId === "string" ? args.matterId.trim() : "";
  const matterNumber =
    typeof args.matterNumber === "string" ? args.matterNumber.trim() : "";
  if (!matterId && !matterNumber)
    return failure("validation", "matterId or matterNumber is required.");
  if (matterId.length > 64 || matterNumber.length > 64)
    return failure("validation", "Matter reference is too long.");
  const mode =
    args.mode === "full" || args.mode === "incremental" ? args.mode : undefined;

  const member = await requireSyncMember(db, args.userId);
  if (!member.ok) return member;
  const requestedBy = args.userEmail?.trim() || args.userId;

  const call = await callFiler(
    "pull",
    {
      ...(matterId ? { matterId } : {}),
      ...(matterNumber ? { matterNumber } : {}),
      requestedBy,
      ...(mode ? { mode } : {}),
    },
    PULL_TIMEOUT_MS,
    fetchImpl,
  );
  if (!call.ok) return failure("unavailable", FILER_UNREACHABLE_MESSAGE);
  if (call.status === 400)
    return failure("validation", "That matter could not be pulled.");
  if (call.status === 404)
    return failure("not_found", "That matter was not found in Zoho.");
  if (call.status === 409)
    return failure("conflict", FOLDER_NOT_READY_MESSAGE, "awaiting_folder");
  if (call.status !== 200) {
    logError("integrations/filer", "pull unavailable", {
      status: call.status,
    });
    return failure("unavailable", FILER_UNREACHABLE_MESSAGE);
  }

  const projectId = stringOrNull(call.body.projectId);
  if (!projectId) {
    logError("integrations/filer", "pull answered without projectId", {
      status: call.status,
    });
    return failure("unavailable", PROJECT_NOT_READY_MESSAGE);
  }
  // Files may still be landing. The per-document ready hook also schedules
  // this; the longer delay covers the first-pass burst after a pull.
  await enqueueProjectMatterBrief(db, projectId, { delayMs: 180_000 });
  const links = await resolveMatterLinks(
    db,
    projectId,
    {
      zohoDealId: filerDealId(call.body),
      sharepointFolderUrl: normalizeHttpUrl(call.body.sharepointFolderUrl),
    },
    fetchImpl,
    { matterNumber: stringOrNull(call.body.matterNumber) },
  );
  await persistMatterLinks(db, projectId, links, "replace");
  return ok({
    projectId,
    created: call.body.created === true,
    matterNumber: stringOrNull(call.body.matterNumber),
    matterName: stringOrNull(call.body.matterName),
    account: stringOrNull(call.body.account),
    description: stringOrNull(call.body.description),
    uploaded: numberOrZero(call.body.uploaded),
    remaining: numberOrZero(call.body.remaining),
    status: statusOf(call.body.status),
    matterId: links.zohoDealId,
    sharepointFolderUrl: links.sharepointFolderUrl,
  });
}

/** The sync row for a project the caller can access, or `found: false`. */
export async function getMatterSyncStatus(
  db: Db,
  args: { userId: string; userEmail: string | null | undefined; projectId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ServiceResult<MatterSyncStatusResult>> {
  const config = filerConfiguration();
  if (!config.configured) return failure("unavailable", UNAVAILABLE_MESSAGE);

  // Project access, not organisation membership, is the gate here: anyone
  // who may see the matter may see whether it is up to date.
  const access = await checkProjectAccess(
    args.projectId,
    args.userId,
    args.userEmail,
    db,
  );
  if (!access.ok) return failure("not_found", "Project not found");

  const call = await callFiler(
    "status",
    { projectId: args.projectId },
    STATUS_TIMEOUT_MS,
    fetchImpl,
  );
  if (!call.ok) return failure("unavailable", FILER_UNREACHABLE_MESSAGE);
  if (call.status !== 200) {
    logError("integrations/filer", "status unavailable", {
      status: call.status,
    });
    return failure("unavailable", FILER_UNREACHABLE_MESSAGE);
  }
  if (call.body.found !== true) return ok({ found: false });
  const links = await resolveMatterLinks(
    db,
    args.projectId,
    {
      zohoDealId: filerDealId(call.body),
      sharepointFolderUrl: normalizeHttpUrl(call.body.sharepointFolderUrl),
    },
    fetchImpl,
    { matterNumber: stringOrNull(call.body.matterNumber) },
  );
  await persistMatterLinks(db, args.projectId, links, "fill");
  return ok({
    found: true,
    status: statusOf(call.body.status),
    matterNumber: stringOrNull(call.body.matterNumber),
    matterName: stringOrNull(call.body.matterName),
    documentCount: numberOrZero(call.body.documentCount),
    remaining: numberOrZero(call.body.remaining),
    lastSyncAt: stringOrNull(call.body.lastSyncAt),
    lastChangeAt: stringOrNull(call.body.lastChangeAt),
    lastError: stringOrNull(call.body.lastError),
    matterId: links.zohoDealId,
    sharepointFolderUrl: links.sharepointFolderUrl,
    files: await listInFlightSyncFiles(db, args.projectId),
  });
}

const OPEN_SESSION_STATUSES = [
  "pending_upload",
  "verifying",
  "uploaded",
  "processing",
  "error",
];

function stageOfSessionFile(status: string): MatterSyncFileStage {
  if (status === "uploaded") return "uploaded";
  if (status === "processing") return "processing";
  if (status === "error") return "error";
  return "queued";
}

/**
 * Names the SharePoint files Railway has not finished. A session file is
 * dropped once its document row exists, so a file is listed once: the
 * document while it is still pending or processing, otherwise the session
 * file. A failed read leaves the list empty; status itself still answers.
 */
async function listInFlightSyncFiles(
  db: Db,
  projectId: string,
): Promise<MatterSyncFile[]> {
  try {
    const { data: sessions, error: sessionError } = await db
      .from("upload_sessions")
      .select(
        "id, destination, status, upload_session_files(id, filename, status, target_folder_id, resource_id)",
      )
      .filter("destination->>project_id", "eq", projectId)
      .in("status", OPEN_SESSION_STATUSES);
    if (sessionError) {
      logError("integrations/ingest", sessionError, { projectId });
      return listProcessingDocuments(db, projectId);
    }

    const openFiles: {
      id: string;
      filename: string;
      status: string;
      folderId: string | null;
      resourceId: string | null;
    }[] = [];
    for (const session of sessions ?? []) {
      const destination = (session as { destination?: unknown }).destination;
      if (
        destination &&
        typeof destination === "object" &&
        (destination as { scope?: unknown }).scope &&
        (destination as { scope?: unknown }).scope !== "project"
      ) {
        continue;
      }
      const nested = (session as { upload_session_files?: unknown })
        .upload_session_files;
      const rows = Array.isArray(nested) ? nested : [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const file = row as Record<string, unknown>;
        const status = stringOrNull(file.status) ?? "";
        if (!status || status === "completed") continue;
        const id = stringOrNull(file.id);
        const filename = stringOrNull(file.filename);
        if (!id || !filename) continue;
        openFiles.push({
          id,
          filename,
          status,
          folderId: stringOrNull(file.target_folder_id),
          resourceId: stringOrNull(file.resource_id),
        });
      }
    }

    const resourceIds = openFiles.flatMap((file) =>
      file.resourceId ? [file.resourceId] : [],
    );
    const existingIds = new Set<string>();
    if (resourceIds.length > 0) {
      const { data: existing, error: existingError } = await db
        .from("documents")
        .select("id")
        .in("id", resourceIds);
      if (existingError) {
        logError("integrations/ingest", existingError, { projectId });
      } else {
        for (const row of existing ?? []) {
          const id = stringOrNull((row as { id?: unknown }).id);
          if (id) existingIds.add(id);
        }
      }
    }

    const processing = await listProcessingDocuments(db, projectId);
    const seen = new Set(processing.map((file) => file.id));
    const files = [...processing];
    for (const file of openFiles) {
      if (file.resourceId && existingIds.has(file.resourceId)) continue;
      if (seen.has(file.id)) continue;
      seen.add(file.id);
      files.push({
        id: file.id,
        filename: file.filename,
        folderId: file.folderId,
        stage: stageOfSessionFile(file.status),
      });
    }
    return files;
  } catch (error) {
    logError("integrations/ingest", error, { projectId });
    return [];
  }
}

async function listProcessingDocuments(
  db: Db,
  projectId: string,
): Promise<MatterSyncFile[]> {
  const { data, error } = await db
    .from("documents")
    .select("id, filename, status, folder_id")
    .eq("project_id", projectId)
    .in("status", ["pending", "processing"]);
  if (error || !data) {
    if (error) logError("integrations/ingest", error, { projectId });
    return [];
  }
  const files: MatterSyncFile[] = [];
  for (const row of data) {
    const doc = row as Record<string, unknown>;
    const id = stringOrNull(doc.id);
    const filename = stringOrNull(doc.filename);
    if (!id || !filename) continue;
    files.push({
      id,
      filename,
      folderId: stringOrNull(doc.folder_id),
      stage: "processing",
    });
  }
  return files;
}

/**
 * After a lawyer saves a version on a synced matter, ask the filer to put
 * that file in the SharePoint DR folder. A failure here leaves the Colleague
 * version in place. The five-minute sweep does not write back, so this save
 * is the only path.
 */
export async function saveSyncedMatterVersionToSharePoint(
  db: Db,
  args: {
    documentId: string;
    versionId: string;
    storagePath: string;
    filename: string;
  },
): Promise<void> {
  const { documentId, versionId, storagePath, filename } = args;
  try {
    const config = filerConfiguration();
    if (!config.configured) return;
    const name = filename.trim();
    if (!documentId || !versionId || !storagePath || !name) return;

    const { data: document, error: documentError } = await db
      .from("documents")
      .select(
        "id, project_id, external_provider, external_item_id, external_ctag",
      )
      .eq("id", documentId)
      .maybeSingle();
    if (documentError || !document?.project_id) return;

    const { data: project, error: projectError } = await db
      .from("projects")
      .select("cm_number")
      .eq("id", document.project_id)
      .maybeSingle();
    if (projectError) return;
    const matterNumber =
      typeof project?.cm_number === "string" ? project.cm_number.trim() : "";
    if (!matterNumber) return;

    const { data: pushed } = await db
      .from("document_versions")
      .select("external_item_id, external_ctag")
      .eq("document_id", documentId)
      .not("external_item_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const externalItemId =
      stringOrNull(pushed?.external_item_id) ||
      stringOrNull(document.external_item_id);
    const externalCtag = pushed
      ? stringOrNull(pushed.external_ctag)
      : stringOrNull(document.external_ctag);

    const sourceUrl = await getSignedUrl(storagePath, 600);
    if (!sourceUrl) return;

    const call = await callFiler(
      "push",
      {
        projectId: document.project_id,
        matterNumber,
        filename: name,
        sourceUrl,
        externalItemId,
        externalCtag,
      },
      PUSH_TIMEOUT_MS,
      fetch,
    );
    if (!call.ok || call.status !== 200) {
      logError(
        "integrations/push",
        filerStatusError(call.ok ? call.status : 0),
        { documentId, versionId },
      );
      return;
    }
    const itemId = stringOrNull(call.body.itemId);
    if (!itemId) return;
    const ctag = stringOrNull(call.body.ctag);
    await recordSharePointVersion(db, {
      documentId,
      versionId,
      itemId,
      ctag,
    });
    if (call.body.created === false && document.external_item_id === itemId && ctag) {
      await db
        .from("documents")
        .update({
          external_ctag: ctag,
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId);
    }
  } catch (error) {
    logError("integrations/push", error, { documentId, versionId });
  }
}

function filerStatusError(status: number): Error {
  return new Error(`filer answered ${status}`);
}

export {
  azureIdentity,
  deleteMicrosoftTokens,
  getGraphAccessToken,
  hasLiveMicrosoftGrant,
  isMicrosoftConnected,
  persistMicrosoftTokens,
  persistProviderSessionTokens,
} from "./integrations.microsoftAuth";
export { createOutlookDraft } from "./integrations.outlookDraft";
export type {
  CreateOutlookDraftInput,
  OutlookDraftResult,
  OutlookThreadStatus,
} from "./integrations.shared";
