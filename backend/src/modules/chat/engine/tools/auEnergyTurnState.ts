import type { EnergyText, EnergyVersion } from "../../../../lib/auEnergy";
import type { AuLegislationRecord, AuLegislationTurnState } from "./auLegislationTurnState";
import { legislationCacheKey, legislationCitationEventFromRecord } from "./auLegislationTurnState";

export function upsertAuEnergy(
    state: AuLegislationTurnState,
    fetched: EnergyText,
): AuLegislationRecord {
    const key = legislationCacheKey(fetched.instrumentId, fetched.asAt);
    const current = state.titlesByCacheKey.get(key);
    const record: AuLegislationRecord = {
        titleId: fetched.instrumentId,
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

export function energyCitationEventFromRecord(record: AuLegislationRecord) {
    return legislationCitationEventFromRecord(record);
}

export function energyVersionSummary(version: EnergyVersion) {
    return {
        instrument_id: version.instrumentId,
        label: version.label,
        start: version.start,
        end: version.end,
        is_latest: version.isLatest,
        url: version.url,
    };
}
