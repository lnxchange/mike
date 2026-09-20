"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getMatterSyncStatus } from "@/app/lib/mikeApi";
import {
    isMatterSyncInProgress,
    type MatterSyncStatusResult,
} from "@/app/lib/matterSync";

export const MATTER_SYNC_POLL_MS = 15_000;

/**
 * The SharePoint sync row for a matter, fetched once and then polled while
 * the filer is still working on it. Informational only: a failed read leaves
 * the status unknown (null) and stops polling rather than surfacing an error.
 *
 * `onDocumentCountIncreased` fires when a poll reports more documents than
 * the previous one, so the page can refresh its document list.
 */
export function useMatterSyncStatus(args: {
    projectId: string;
    enabled: boolean;
    onDocumentCountIncreased?: () => void;
}) {
    const { projectId, enabled, onDocumentCountIncreased } = args;
    // Keyed by project so a navigation to another matter reads as "unknown"
    // without an effect having to clear the previous answer.
    const [reading, setReading] = useState<{
        projectId: string;
        status: MatterSyncStatusResult | null;
    } | null>(null);
    const lastCountRef = useRef<{ projectId: string; count: number } | null>(
        null,
    );
    const increasedRef = useRef(onDocumentCountIncreased);
    useEffect(() => {
        increasedRef.current = onDocumentCountIncreased;
    }, [onDocumentCountIncreased]);

    const refresh = useCallback(async (): Promise<MatterSyncStatusResult | null> => {
        if (!enabled) return null;
        try {
            const next = await getMatterSyncStatus(projectId);
            setReading({ projectId, status: next });
            if (next.found) {
                const previous = lastCountRef.current;
                if (
                    previous?.projectId === projectId &&
                    next.documentCount > previous.count
                ) {
                    increasedRef.current?.();
                }
                lastCountRef.current = { projectId, count: next.documentCount };
            }
            return next;
        } catch {
            setReading({ projectId, status: null });
            return null;
        }
    }, [enabled, projectId]);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        let timer: number | null = null;

        const tick = async () => {
            const next = await refresh();
            if (cancelled) return;
            if (next?.found && isMatterSyncInProgress(next.status)) {
                timer = window.setTimeout(() => void tick(), MATTER_SYNC_POLL_MS);
            }
        };
        void tick();

        return () => {
            cancelled = true;
            if (timer !== null) window.clearTimeout(timer);
        };
    }, [enabled, refresh]);

    const current = enabled && reading?.projectId === projectId ? reading : null;
    return {
        status: current?.status ?? null,
        /** True once the first read for this project has settled. */
        loaded: current !== null,
        refresh,
    };
}
