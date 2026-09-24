// Wire shapes for the Zoho matter pull and SharePoint sync surface
// (backend/src/modules/integrations). Kept apart from mikeApi.ts so the
// modal, the matter header and their tests share one vocabulary.

import { appConfig } from "@/config";

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
    /** False until Easy SharePoint has provisioned the matter folder. */
    hasFolder: boolean;
};

export type MatterPullResult = {
    projectId: string;
    created: boolean;
    matterNumber: string | null;
    matterName: string | null;
    account?: string | null;
    description?: string | null;
    uploaded: number;
    remaining: number;
    status: MatterSyncStatus;
    matterId?: string | null;
    sharepointFolderUrl?: string | null;
};

export type MatterSyncFileStage =
    | "queued"
    | "uploaded"
    | "processing"
    | "error";

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
          matterId?: string | null;
          sharepointFolderUrl?: string | null;
          /** Files handed to Railway that are not ready documents yet. */
          files?: MatterSyncFile[];
      };

/** Build the Zoho Deal URL for a matter, or null when this profile has none. */
export function zohoMatterUrl(
    dealId: string | null | undefined,
): string | null {
    const base = appConfig.externalLinks.zohoMatterBase?.replace(/\/$/, "");
    const id = dealId?.trim();
    if (!base || !id) return null;
    return `${base}/${encodeURIComponent(id)}`;
}

export function sharepointFolderUrl(
    value: string | null | undefined,
): string | null {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return null;
        }
        return trimmed;
    } catch {
        return null;
    }
}

/** Statuses the filer will move on from without anyone asking. */
export function isMatterSyncInProgress(status: MatterSyncStatus): boolean {
    return (
        status === "Syncing" ||
        status === "Creating" ||
        status === "AwaitingFolder"
    );
}

export type MatterSyncVisible = {
    visibleDocumentCount?: number;
};

/** True when the filer has counted files that are not yet ready on the page. */
export function isMatterSyncProcessing(
    result: MatterSyncStatusResult | null,
    visibleDocumentCount?: number,
): boolean {
    if (!result?.found) return false;
    if (typeof visibleDocumentCount !== "number") return false;
    return result.documentCount > visibleDocumentCount;
}

export function matterSyncOpenFiles(
    result: MatterSyncStatusResult | null,
): MatterSyncFile[] {
    return result?.found ? (result.files ?? []) : [];
}

/**
 * True until the filer is idle, nothing is still queued in SharePoint, and
 * Railway has no open file for this matter. Idle with a higher document
 * count than the page has rendered is still unfinished.
 */
export function isMatterSyncUnsettled(
    result: MatterSyncStatusResult | null,
    visibleDocumentCount?: number,
): boolean {
    if (!result?.found) return false;
    if (isMatterSyncInProgress(result.status)) return true;
    if (result.remaining > 0) return true;
    if ((result.files?.length ?? 0) > 0) return true;
    return isMatterSyncProcessing(result, visibleDocumentCount);
}

export function matterSyncTotals(
    result: Extract<MatterSyncStatusResult, { found: true }>,
    visibleDocumentCount?: number,
): { ready: number; total: number } {
    const ready = visibleDocumentCount ?? 0;
    const known = Math.max(
        result.documentCount,
        ready + (result.files?.length ?? 0),
    );
    return { ready, total: known + result.remaining };
}

const JUST_PULLED_KEY = "libris.matterSync.justPulled";

/** Remember a pull so the matter page says it is syncing before the first status read. */
export function rememberJustPulledMatter(projectId: string): void {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(JUST_PULLED_KEY, projectId);
}

export function readJustPulledMatter(projectId: string): boolean {
    if (typeof sessionStorage === "undefined") return false;
    return sessionStorage.getItem(JUST_PULLED_KEY) === projectId;
}

export function clearJustPulledMatter(projectId: string): void {
    if (typeof sessionStorage === "undefined") return;
    if (sessionStorage.getItem(JUST_PULLED_KEY) === projectId) {
        sessionStorage.removeItem(JUST_PULLED_KEY);
    }
}

/**
 * The one-line, plain-text summary the matter header shows. Returns null when
 * there is nothing to say (no sync row).
 */
export function describeMatterSync(
    result: MatterSyncStatusResult | null,
    options?: MatterSyncVisible,
): string | null {
    if (!result || !result.found) return null;
    const visible = options?.visibleDocumentCount;
    const processing =
        typeof visible === "number" && result.documentCount > visible;
    const openFiles = result.files?.length ?? 0;
    switch (result.status) {
        case "AwaitingFolder":
            return "Waiting for the SharePoint folder";
        case "Creating":
            return "Setting up the SharePoint sync";
        case "Syncing": {
            if (openFiles > 0) return describeSyncing(result, visible);
            if (processing && result.remaining === 0) {
                return describeProcessing(visible ?? 0, result.documentCount);
            }
            const soFar = `${result.documentCount} ${
                result.documentCount === 1 ? "document" : "documents"
            } so far`;
            return result.remaining > 0
                ? `Syncing from SharePoint, ${soFar}, ${result.remaining} to go`
                : `Syncing from SharePoint, ${soFar}`;
        }
        case "Idle":
            if (openFiles > 0 || result.remaining > 0) {
                return describeSyncing(result, visible);
            }
            return processing
                ? describeProcessing(visible ?? 0, result.documentCount)
                : "Up to date with SharePoint";
        case "Paused":
            return "Sync paused";
        case "Failed":
        case "TimedOut":
            return "Sync failed, see Back Office";
    }
}

function describeProcessing(ready: number, expected: number): string {
    return `Processing documents from SharePoint, ${ready} of ${expected} ready`;
}

function describeSyncing(
    result: Extract<MatterSyncStatusResult, { found: true }>,
    visibleDocumentCount?: number,
): string {
    const { ready, total } = matterSyncTotals(result, visibleDocumentCount);
    return `Syncing from SharePoint, ${ready} of ${total} ready`;
}
