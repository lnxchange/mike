import type { VicText, VicVersion } from "../../../../lib/auVicLegislation";
import type { AuLegislationRecord, AuLegislationTurnState } from "./auLegislationTurnState";
import { legislationCacheKey, legislationCitationEventFromRecord } from "./auLegislationTurnState";

export function upsertAuVicLegislation(
    state: AuLegislationTurnState,
    fetched: VicText,
): AuLegislationRecord {
    const key = legislationCacheKey(fetched.titleId, fetched.asAt);
    const current = state.titlesByCacheKey.get(key);
    const record: AuLegislationRecord = {
        titleId: fetched.titleId,
        name: fetched.name,
        asAt: fetched.asAt,
        registerId: null,
        compilationNumber: fetched.versionLabel,
        status: fetched.end ? "superseded" : "current",
        start: fetched.start,
        end: fetched.end,
        url: fetched.url,
        provisions: current?.provisions ?? [],
        fullText: current?.fullText
            ? current.fullText.includes(fetched.text)
                ? current.fullText
                : `${current.fullText}\n\n${fetched.text}`
            : fetched.text,
    };
    state.titlesByCacheKey.set(key, record);
    return record;
}

export function vicCitationEventFromRecord(record: AuLegislationRecord) {
    return legislationCitationEventFromRecord(record);
}

export function vicVersionSummary(version: VicVersion) {
    return {
        title_id: version.titleId,
        label: version.label,
        start: version.start,
        end: version.end,
        is_latest: version.isLatest,
        url: version.url,
    };
}
