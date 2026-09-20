// Wire shapes for the Zoho matter pull and SharePoint sync surface
// (backend/src/modules/integrations). Kept apart from mikeApi.ts so the
// modal, the matter header and their tests share one vocabulary.

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

/** Statuses the filer will move on from without anyone asking. */
export function isMatterSyncInProgress(status: MatterSyncStatus): boolean {
    return (
        status === "Syncing" ||
        status === "Creating" ||
        status === "AwaitingFolder"
    );
}

/**
 * The one-line, plain-text summary the matter header shows. Returns null when
 * there is nothing to say (no sync row).
 */
export function describeMatterSync(
    result: MatterSyncStatusResult | null,
): string | null {
    if (!result || !result.found) return null;
    switch (result.status) {
        case "AwaitingFolder":
            return "Waiting for the SharePoint folder";
        case "Creating":
            return "Setting up the SharePoint sync";
        case "Syncing": {
            const soFar = `${result.documentCount} ${
                result.documentCount === 1 ? "document" : "documents"
            } so far`;
            return result.remaining > 0
                ? `Syncing from SharePoint, ${soFar}, ${result.remaining} to go`
                : `Syncing from SharePoint, ${soFar}`;
        }
        case "Idle":
            return "Up to date with SharePoint";
        case "Paused":
            return "Sync paused";
        case "Failed":
        case "TimedOut":
            return "Sync failed, see Back Office";
    }
}
