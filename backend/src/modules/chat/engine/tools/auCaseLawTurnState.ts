import type { AuCaseText } from "../../../../lib/auCaseLaw";
import type { AuLegislationRecord, AuLegislationTurnState } from "./auLegislationTurnState";
import { legislationCacheKey, legislationCitationEventFromRecord } from "./auLegislationTurnState";

export function upsertAuCase(
    state: AuLegislationTurnState,
    fetched: AuCaseText,
): AuLegislationRecord {
    const key = legislationCacheKey(fetched.id, null);
    const current = state.titlesByCacheKey.get(key);
    const record: AuLegislationRecord = {
        titleId: fetched.id,
        name: fetched.name,
        asAt: null,
        registerId: fetched.citation,
        compilationNumber: fetched.court,
        status: "current",
        start: fetched.date,
        end: null,
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

export function caseCitationEventFromAuRecord(record: AuLegislationRecord) {
    return legislationCitationEventFromRecord(record);
}
