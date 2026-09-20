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

import { checkProjectAccess, getOrgRole } from "../../lib/access";
import { logError } from "../../lib/log";
import { filerConfiguration } from "../../lib/runtimeConfig";
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
  action: "search" | "pull" | "status",
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
  });
}

function filerStatusError(status: number): Error {
  return new Error(`filer answered ${status}`);
}
