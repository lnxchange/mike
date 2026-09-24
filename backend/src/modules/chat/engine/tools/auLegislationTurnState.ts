import { registerUrl, type FrlLegislationText, type FrlVersion } from "../../../../lib/frl";
import { actFullText, type FrlProvision } from "../../../../lib/frlText";
import { normalizeLegislationDocument } from "../../../../lib/sourceDocuments";
import type { LegislationCitationEvent } from "./auLegislationTools";

export type AuLegislationRecord = {
    titleId: string;
    name: string | null;
    asAt: string | null;
    registerId: string | null;
    compilationNumber: string | null;
    status: string | null;
    start: string | null;
    end: string | null;
    url: string;
    provisions: FrlProvision[];
    fullText: string;
};

export type AuLegislationTurnState = {
    titlesByCacheKey: Map<string, AuLegislationRecord>;
};

export function legislationCacheKey(
    titleId: string,
    asAt?: string | null,
): string {
    return `${titleId.trim().toUpperCase()}:${asAt ?? "latest"}`;
}

export function upsertAuLegislation(
    state: AuLegislationTurnState,
    fetched: FrlLegislationText,
): AuLegislationRecord {
    const titleId = fetched.version.titleId;
    const key = legislationCacheKey(titleId, fetched.asAt);
    const current = state.titlesByCacheKey.get(key);
    const provisions = fetched.provision
        ? mergeProvisions(current?.provisions ?? [], [fetched.provision])
        : mergeProvisions(current?.provisions ?? [], fetched.provisions);
    const record: AuLegislationRecord = {
        titleId,
        name: fetched.title?.name ?? fetched.version.name ?? current?.name ?? null,
        asAt: fetched.asAt,
        registerId: fetched.version.registerId,
        compilationNumber: fetched.version.compilationNumber,
        status: fetched.version.status,
        start: fetched.version.start,
        end: fetched.version.end,
        url: fetched.url,
        provisions,
        fullText: current?.fullText
            ? mergeFullText(current.fullText, fetched.text)
            : fetched.text,
    };
    if (provisions.length && !fetched.section) {
        record.fullText = actFullText({ provisions, endnotes: "" }) || record.fullText;
    }
    state.titlesByCacheKey.set(key, record);
    return record;
}

function mergeProvisions(
    current: FrlProvision[],
    incoming: FrlProvision[],
): FrlProvision[] {
    const byNo = new Map<string, FrlProvision>();
    for (const provision of [...current, ...incoming]) {
        byNo.set(provision.no, provision);
    }
    return [...byNo.values()];
}

function mergeFullText(current: string, incoming: string): string {
    if (!incoming) return current;
    if (!current) return incoming;
    if (current.includes(incoming) || incoming.includes(current)) {
        return current.length >= incoming.length ? current : incoming;
    }
    return `${current}\n\n${incoming}`;
}

export function getCachedLegislation(
    state: AuLegislationTurnState,
    titleId: string,
    asAt?: string | null,
): AuLegislationRecord | null {
    return state.titlesByCacheKey.get(legislationCacheKey(titleId, asAt)) ?? null;
}

export function getCachedLegislationText(
    state: AuLegislationTurnState,
    titleId: string,
    asAt?: string | null,
): string {
    return getCachedLegislation(state, titleId, asAt)?.fullText ?? "";
}

export function legislationCitationEventFromRecord(
    record: AuLegislationRecord,
): LegislationCitationEvent {
    return {
        type: "legislation_citation",
        title_id: record.titleId,
        name: record.name,
        as_at: record.asAt,
        compilation_number: record.compilationNumber,
        url: record.url,
        document: normalizeLegislationDocument({
            titleId: record.titleId,
            name: record.name,
            asAt: record.asAt,
            compilationNumber: record.compilationNumber,
            url: record.url,
        }),
    };
}

export function versionSummary(version: FrlVersion) {
    return {
        title_id: version.titleId,
        name: version.name,
        status: version.status,
        start: version.start,
        end: version.end,
        register_id: version.registerId,
        compilation_number: version.compilationNumber,
        is_latest: version.isLatest,
        url: version.url || registerUrl(version.titleId, version.start.slice(0, 10)),
        reasons: version.reasons,
    };
}
