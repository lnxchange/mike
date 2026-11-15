import {
    getEnergyText,
    listEnergyVersions,
    resolveEnergyInstrument,
} from "./auEnergy";
import {
    getVicLegislationText,
    listVicVersions,
} from "./auVicLegislation";
import type { ExaContentsFetch } from "./exaContents";
import { enqueueDbJob } from "./dbq/enqueue";
import type { Db, DbJob } from "./dbq/types";
import {
    createOrgLegalSourceStore,
    createLegalSourceStore,
    type LegalSourceFamily,
    type LegalSourceRetrievedVia,
    type LegalSourceStore,
} from "./legalSourceStore";
import { logError } from "./log";
import type { Db as SupabaseDb } from "./supabase";

export const LEGAL_SHELF_JOB_KIND = "legal.shelf.refresh";
export const LEGAL_SHELF_DEDUPE_KEY = "legal.shelf.refresh";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const ENERGY_SHELF_IDS = [
    "esc:ercop",
    "esc:edcop",
    "esc:gdcop",
    "esc:vdo",
    "esc:cprg",
    "sa:nerl",
    "sa:nel",
    "sa:ngl",
    "nsw:nerl-adoption",
    "qld:nerl-adoption",
    "act:nerl-adoption",
    "aemc:nerr",
    "aemc:ner",
    "aemc:ngr",
    "aer:hardship",
    "aer:better-bills",
    "aer:retailer-authorisation",
    "aer:rpig",
    "aer:retail-compliance",
    "aer:exempt-selling",
    "aer:dmo",
    "aer:ring-fencing-ed",
    "aemo:msats",
    "aemo:b2b",
    "aemo:metering",
] as const;

export const VIC_SHELF_IDS = [
    "vic:electricity-industry-act-2000",
    "vic:gas-industry-act-2001",
] as const;

export type ShelfSeedRow = {
    instrumentId: string;
    family: LegalSourceFamily;
    versionLabel: string | null;
    retrievedVia: LegalSourceRetrievedVia | "store" | null;
    chars: number;
    error: string | null;
};

export type ShelfRefreshAction =
    | "current"
    | "updated"
    | "unconfirmed"
    | "skipped";

export type HeldShelfRow = {
    id: string;
    orgId: string | null;
    userId: string | null;
    family: "energy" | "vic_legislation";
    instrumentId: string;
    name: string;
    versionLabel: string | null;
    officialUrl: string;
};

export type ShelfRefreshRow = {
    instrumentId: string;
    family: "energy" | "vic_legislation";
    action: ShelfRefreshAction;
    versionLabel: string | null;
    error?: string;
};

export type LegalShelfRefreshDeps = {
    listEnergyVersions?: typeof listEnergyVersions;
    getEnergyText?: typeof getEnergyText;
    listVicVersions?: typeof listVicVersions;
    getVicLegislationText?: typeof getVicLegislationText;
};

export function legalShelfRefreshIntervalMs(): number {
    const raw = Number(process.env.LEGAL_SHELF_REFRESH_INTERVAL_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : WEEK_MS;
}

export function legalShelfCheckIntervalMs(): number {
    const raw = Number(process.env.LEGAL_SHELF_CHECK_INTERVAL_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : 24 * 60 * 60 * 1000;
}

export function normalizeVersionLabel(value: string | null | undefined): string {
    return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function sameOfficialVersion(
    held: { versionLabel: string | null; officialUrl: string },
    official: { label: string; url: string; downloadUrl?: string | null },
): boolean {
    if (
        normalizeVersionLabel(held.versionLabel) ===
        normalizeVersionLabel(official.label)
    ) {
        return true;
    }
    const officialUrls = [official.downloadUrl, official.url].filter(
        (url): url is string => Boolean(url),
    );
    return officialUrls.some((url) => urlsMatch(held.officialUrl, url));
}

function urlsMatch(left: string, right: string): boolean {
    try {
        const a = new URL(left);
        const b = new URL(right);
        return (
            a.origin === b.origin &&
            a.pathname.replace(/\/+$/, "") === b.pathname.replace(/\/+$/, "")
        );
    } catch {
        return left.trim() === right.trim();
    }
}

export function legalShelfRefreshIsDue(
    latest: { status: string; finished_at: string | null } | null,
    now = Date.now(),
    intervalMs = legalShelfRefreshIntervalMs(),
): boolean {
    if (!latest) return true;
    if (latest.status === "pending" || latest.status === "running") return false;
    if (latest.status === "done" && latest.finished_at) {
        const finished = Date.parse(latest.finished_at);
        if (Number.isFinite(finished) && now - finished < intervalMs) {
            return false;
        }
    }
    return true;
}

export function formatShelfSeedSummary(rows: ShelfSeedRow[]): string {
    return rows
        .map((row) => {
            if (row.error) {
                return `${row.instrumentId}\tERROR\t${row.error}`;
            }
            return [
                row.instrumentId,
                row.versionLabel ?? "-",
                row.retrievedVia ?? "-",
                `${row.chars} chars`,
            ].join("\t");
        })
        .join("\n");
}

export async function seedEnergyShelf(args: {
    store: LegalSourceStore;
    fetchImpl?: typeof fetch;
    exaFetch?: ExaContentsFetch;
}): Promise<ShelfSeedRow[]> {
    const rows: ShelfSeedRow[] = [];
    for (const instrumentId of ENERGY_SHELF_IDS) {
        rows.push(
            await seedOneEnergy(instrumentId, args.store, args.fetchImpl, args.exaFetch),
        );
    }
    for (const titleId of VIC_SHELF_IDS) {
        rows.push(
            await seedOneVic(titleId, args.store, args.fetchImpl, args.exaFetch),
        );
    }
    return rows;
}

async function seedOneEnergy(
    instrumentId: string,
    store: LegalSourceStore,
    fetchImpl?: typeof fetch,
    exaFetch?: ExaContentsFetch,
): Promise<ShelfSeedRow> {
    const instrument = resolveEnergyInstrument(instrumentId);
    if (!instrument) {
        return {
            instrumentId,
            family: "energy",
            versionLabel: null,
            retrievedVia: null,
            chars: 0,
            error: "Unknown energy instrument id.",
        };
    }
    try {
        const fetched = await getEnergyText(instrumentId, {
            store,
            fetchImpl,
            exaFetch,
            fullSnapshot: instrument.source === "aemc",
        });
        const held = await store.lookupLatest("energy", instrumentId);
        return {
            instrumentId,
            family: "energy",
            versionLabel: held?.versionLabel ?? fetched.versionLabel,
            retrievedVia: held?.retrievedVia ?? fetched.retrievedVia ?? null,
            chars: held?.fullText.length ?? fetched.text.length,
            error: null,
        };
    } catch (err) {
        return {
            instrumentId,
            family: "energy",
            versionLabel: null,
            retrievedVia: null,
            chars: 0,
            error: err instanceof Error ? err.message : "Energy seed failed.",
        };
    }
}

async function seedOneVic(
    titleId: string,
    store: LegalSourceStore,
    fetchImpl?: typeof fetch,
    exaFetch?: ExaContentsFetch,
): Promise<ShelfSeedRow> {
    try {
        const fetched = await getVicLegislationText(titleId, {
            store,
            fetchImpl,
            exaFetch,
        });
        const held = await store.lookupLatest("vic_legislation", titleId);
        return {
            instrumentId: titleId,
            family: "vic_legislation",
            versionLabel: held?.versionLabel ?? fetched.versionLabel,
            retrievedVia: held?.retrievedVia ?? null,
            chars: held?.fullText.length ?? fetched.text.length,
            error: null,
        };
    } catch (err) {
        return {
            instrumentId: titleId,
            family: "vic_legislation",
            versionLabel: null,
            retrievedVia: null,
            chars: 0,
            error: err instanceof Error ? err.message : "Victorian seed failed.",
        };
    }
}

export async function refreshHeldLegalSources(
    held: HeldShelfRow[],
    deps: LegalShelfRefreshDeps & {
        markCurrent: (id: string) => Promise<void>;
        markUnconfirmed: (id: string) => Promise<void>;
        replace: (
            id: string,
            next: {
                name?: string;
                versionLabel: string;
                officialUrl: string;
                fullText: string;
                retrievedVia: LegalSourceRetrievedVia;
            },
        ) => Promise<void>;
    },
): Promise<ShelfRefreshRow[]> {
    const listEnergy = deps.listEnergyVersions ?? listEnergyVersions;
    const loadEnergy = deps.getEnergyText ?? getEnergyText;
    const listVic = deps.listVicVersions ?? listVicVersions;
    const loadVic = deps.getVicLegislationText ?? getVicLegislationText;
    const latestByKey = new Map<string, HeldShelfRow>();
    for (const row of held) {
        const key = `${row.orgId ?? row.userId}:${row.family}:${row.instrumentId}`;
        if (!latestByKey.has(key)) latestByKey.set(key, row);
    }

    const results: ShelfRefreshRow[] = [];
    for (const row of latestByKey.values()) {
        results.push(
            await refreshOne(row, {
                listEnergy,
                loadEnergy,
                listVic,
                loadVic,
                markCurrent: deps.markCurrent,
                markUnconfirmed: deps.markUnconfirmed,
                replace: deps.replace,
            }),
        );
    }
    return results;
}

async function refreshOne(
    row: HeldShelfRow,
    deps: {
        listEnergy: typeof listEnergyVersions;
        loadEnergy: typeof getEnergyText;
        listVic: typeof listVicVersions;
        loadVic: typeof getVicLegislationText;
        markCurrent: (id: string) => Promise<void>;
        markUnconfirmed: (id: string) => Promise<void>;
        replace: (
            id: string,
            next: {
                name?: string;
                versionLabel: string;
                officialUrl: string;
                fullText: string;
                retrievedVia: LegalSourceRetrievedVia;
            },
        ) => Promise<void>;
    },
): Promise<ShelfRefreshRow> {
    try {
        if (row.family === "energy") {
            const versions = await deps.listEnergy(row.instrumentId);
            const latest = versions[0];
            if (!latest) {
                await deps.markUnconfirmed(row.id);
                return {
                    instrumentId: row.instrumentId,
                    family: row.family,
                    action: "unconfirmed",
                    versionLabel: row.versionLabel,
                    error: "No official versions were listed.",
                };
            }
            if (
                sameOfficialVersion(row, {
                    label: latest.label,
                    url: latest.url,
                    downloadUrl: latest.downloadUrl,
                })
            ) {
                await deps.markCurrent(row.id);
                return {
                    instrumentId: row.instrumentId,
                    family: row.family,
                    action: "current",
                    versionLabel: latest.label,
                };
            }
            const instrument = resolveEnergyInstrument(row.instrumentId);
            const fetched = await deps.loadEnergy(row.instrumentId, {
                fullSnapshot: instrument?.source === "aemc",
                returnFullText: true,
            });
            await deps.replace(row.id, {
                name: fetched.name,
                versionLabel: fetched.versionLabel ?? latest.label,
                officialUrl: fetched.url,
                fullText: fetched.text,
                retrievedVia:
                    fetched.retrievedVia === "store" || !fetched.retrievedVia
                        ? "official"
                        : fetched.retrievedVia,
            });
            return {
                instrumentId: row.instrumentId,
                family: row.family,
                action: "updated",
                versionLabel: fetched.versionLabel ?? latest.label,
            };
        }

        const { versions } = await deps.listVic(row.instrumentId);
        const latest = versions[0];
        if (!latest) {
            await deps.markUnconfirmed(row.id);
            return {
                instrumentId: row.instrumentId,
                family: row.family,
                action: "unconfirmed",
                versionLabel: row.versionLabel,
                error: "No official versions were listed.",
            };
        }
        if (
            sameOfficialVersion(row, {
                label: latest.label,
                url: latest.url,
                downloadUrl: latest.fileUrl,
            })
        ) {
            await deps.markCurrent(row.id);
            return {
                instrumentId: row.instrumentId,
                family: row.family,
                action: "current",
                versionLabel: latest.label,
            };
        }
        const fetched = await deps.loadVic(row.instrumentId, {
            returnFullText: true,
        });
        await deps.replace(row.id, {
            name: fetched.name,
            versionLabel: fetched.versionLabel ?? latest.label,
            officialUrl: fetched.url,
            fullText: fetched.text,
            retrievedVia: "official",
        });
        return {
            instrumentId: row.instrumentId,
            family: row.family,
            action: "updated",
            versionLabel: fetched.versionLabel ?? latest.label,
        };
    } catch (err) {
        await deps.markUnconfirmed(row.id).catch(() => undefined);
        return {
            instrumentId: row.instrumentId,
            family: row.family,
            action: "unconfirmed",
            versionLabel: row.versionLabel,
            error: err instanceof Error ? err.message : "Currency check failed.",
        };
    }
}

type HeldRowQuery = {
    id: string;
    org_id: string | null;
    user_id: string | null;
    family: string;
    instrument_id: string;
    name: string;
    version_label: string | null;
    official_url: string;
    last_used_at: string;
};

export async function loadHeldShelfRows(db: SupabaseDb): Promise<HeldShelfRow[]> {
    const { data, error } = await db
        .from("legal_source_documents")
        .select(
            "id, org_id, user_id, family, instrument_id, name, version_label, official_url, last_used_at",
        )
        .in("family", ["energy", "vic_legislation"])
        .order("last_used_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as HeldRowQuery[])
        .filter(
            (row) =>
                row.family === "energy" || row.family === "vic_legislation",
        )
        .map((row) => ({
            id: row.id,
            orgId: row.org_id,
            userId: row.user_id,
            family: row.family as "energy" | "vic_legislation",
            instrumentId: row.instrument_id,
            name: row.name,
            versionLabel: row.version_label,
            officialUrl: row.official_url,
        }));
}

export async function refreshHeldLegalSourcesFromDb(
    db: SupabaseDb,
    deps: LegalShelfRefreshDeps = {},
): Promise<ShelfRefreshRow[]> {
    const held = await loadHeldShelfRows(db);
    return refreshHeldLegalSources(held, {
        ...deps,
        markCurrent: async (id) => {
            const now = new Date().toISOString();
            await db
                .from("legal_source_documents")
                .update({
                    currency_status: "current",
                    last_checked_at: now,
                    updated_at: now,
                })
                .eq("id", id);
        },
        markUnconfirmed: async (id) => {
            const now = new Date().toISOString();
            await db
                .from("legal_source_documents")
                .update({
                    currency_status: "unconfirmed",
                    last_checked_at: now,
                    updated_at: now,
                })
                .eq("id", id);
        },
        replace: async (id, next) => {
            const now = new Date().toISOString();
            await db
                .from("legal_source_documents")
                .update({
                    name: next.name,
                    version_label: next.versionLabel,
                    official_url: next.officialUrl,
                    retrieved_via: next.retrievedVia,
                    currency_status: "current",
                    last_checked_at: now,
                    last_used_at: now,
                    full_text: next.fullText,
                    updated_at: now,
                })
                .eq("id", id);
        },
    });
}

export async function handleLegalShelfRefresh(
    db: Db,
    _job: DbJob,
): Promise<Record<string, unknown>> {
    const results = await refreshHeldLegalSourcesFromDb(db);
    const summary = {
        checked: results.length,
        current: results.filter((row) => row.action === "current").length,
        updated: results.filter((row) => row.action === "updated").length,
        unconfirmed: results.filter((row) => row.action === "unconfirmed").length,
    };
    return summary;
}

export async function enqueueLegalShelfRefreshIfDue(
    db: SupabaseDb,
): Promise<{ enqueued: boolean; deduped?: boolean }> {
    const { data, error } = await db
        .from("db_jobs")
        .select("status, finished_at")
        .eq("kind", LEGAL_SHELF_JOB_KIND)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw new Error(error.message);
    const latest = (data as { status: string; finished_at: string | null } | null) ??
        null;
    if (!legalShelfRefreshIsDue(latest)) {
        return { enqueued: false };
    }
    const result = await enqueueDbJob(db, {
        kind: LEGAL_SHELF_JOB_KIND,
        payload: {},
        dedupeKey: LEGAL_SHELF_DEDUPE_KEY,
        maxAttempts: 3,
    });
    return { enqueued: !result.deduped, deduped: result.deduped };
}

export type ShelfScope = {
    orgId: string | null;
    userId: string | null;
    label: string;
};

export async function resolveShelfScope(db: SupabaseDb): Promise<ShelfScope> {
    const forcedOrg = process.env.LEGAL_SOURCE_ORG_ID?.trim();
    if (forcedOrg) {
        return {
            orgId: forcedOrg,
            userId: process.env.LEGAL_SOURCE_USER_ID?.trim() || null,
            label: `org ${forcedOrg} (LEGAL_SOURCE_ORG_ID)`,
        };
    }
    const { data: orgs, error } = await db
        .from("organizations")
        .select("id, name")
        .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const list = (orgs ?? []) as { id: string; name: string }[];
    const attune = list.find((org) => /attune/i.test(org.name));
    const chosen = attune ?? list[0];
    if (chosen) {
        return {
            orgId: chosen.id,
            userId: null,
            label: `${chosen.name} (${chosen.id})`,
        };
    }
    const forcedUser = process.env.LEGAL_SOURCE_USER_ID?.trim();
    if (forcedUser) {
        return {
            orgId: null,
            userId: forcedUser,
            label: `user ${forcedUser} (LEGAL_SOURCE_USER_ID)`,
        };
    }
    throw new Error(
        "No organisation found to scope the energy shelf. Set LEGAL_SOURCE_ORG_ID or create an organisation first.",
    );
}

export function storeForShelfScope(
    db: SupabaseDb,
    scope: ShelfScope,
): LegalSourceStore {
    if (scope.orgId) {
        return createOrgLegalSourceStore(db, {
            orgId: scope.orgId,
            userId: scope.userId,
        });
    }
    if (!scope.userId) {
        throw new Error("Energy shelf scope is missing both org and user.");
    }
    return createLegalSourceStore(db, { userId: scope.userId });
}

export function logLegalShelfEnqueueFailure(err: unknown): void {
    logError("legal-shelf", err, { step: "enqueue" });
}
