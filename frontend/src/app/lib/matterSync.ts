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
    switch (result.status) {
        case "AwaitingFolder":
            return "Waiting for the SharePoint folder";
        case "Creating":
            return "Setting up the SharePoint sync";
        case "Syncing": {
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
