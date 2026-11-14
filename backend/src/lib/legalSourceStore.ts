import type { Db } from "./supabase";
import { downloadFile, extractedTextKey } from "./storage";
import { inspectOfficialSourceError } from "./officialSourceAccess";
import type { ExaContentsFetch } from "./exaContents";

export const LEGAL_SOURCE_FAMILIES = [
    "energy",
    "legislation",
    "vic_legislation",
    "case_law",
] as const;

export type LegalSourceFamily = (typeof LEGAL_SOURCE_FAMILIES)[number];
export type LegalSourceRetrievedVia = "official" | "exa" | "upload";
export type LegalSourceCurrency = "current" | "unconfirmed" | "superseded";

export type LegalSourceRecord = {
    id: string;
    family: LegalSourceFamily;
    instrumentId: string;
    name: string;
    versionLabel: string | null;
    officialUrl: string;
    retrievedVia: LegalSourceRetrievedVia;
    currencyStatus: LegalSourceCurrency;
    fullText: string;
};

export type LegalSourceUpsert = {
    family: LegalSourceFamily;
    instrumentId: string;
    name: string;
    versionLabel?: string | null;
    officialUrl: string;
    retrievedVia: LegalSourceRetrievedVia;
    currencyStatus?: LegalSourceCurrency;
    fullText: string;
};

export type ResolvedLegalSource = {
    fullText: string;
    officialUrl: string;
    versionLabel: string | null;
    retrievedVia: LegalSourceRetrievedVia | "store";
    currencyStatus: LegalSourceCurrency;
};

export type LegalSourceStore = {
    lookup(
        family: LegalSourceFamily,
        instrumentId: string,
        versionLabel?: string | null,
    ): Promise<LegalSourceRecord | null>;
    lookupLatest(
        family: LegalSourceFamily,
        instrumentId: string,
    ): Promise<LegalSourceRecord | null>;
    upsert(row: LegalSourceUpsert): Promise<LegalSourceRecord | null>;
    touch(
        id: string,
        patch?: { currencyStatus?: LegalSourceCurrency },
    ): Promise<void>;
    update(
        id: string,
        patch: Partial<LegalSourceUpsert>,
    ): Promise<LegalSourceRecord | null>;
};

type LegalSourceRow = {
    id: string;
    family: string;
    instrument_id: string;
    name: string;
    version_label: string | null;
    official_url: string;
    retrieved_via: string;
    currency_status: string;
    full_text: string;
};

function isFamily(value: string): value is LegalSourceFamily {
    return (LEGAL_SOURCE_FAMILIES as readonly string[]).includes(value);
}

function isRetrievedVia(value: string): value is LegalSourceRetrievedVia {
    return value === "official" || value === "exa" || value === "upload";
}

function isCurrency(value: string): value is LegalSourceCurrency {
    return (
        value === "current" ||
        value === "unconfirmed" ||
        value === "superseded"
    );
}

function mapRow(row: LegalSourceRow): LegalSourceRecord | null {
    if (!isFamily(row.family) || !isRetrievedVia(row.retrieved_via)) return null;
    if (!isCurrency(row.currency_status)) return null;
    if (!row.full_text?.trim()) return null;
    return {
        id: row.id,
        family: row.family,
        instrumentId: row.instrument_id,
        name: row.name,
        versionLabel: row.version_label,
        officialUrl: row.official_url,
        retrievedVia: row.retrieved_via,
        currencyStatus: row.currency_status,
        fullText: row.full_text,
    };
}

async function resolveScope(
    db: Db,
    userId: string,
    projectId?: string | null,
): Promise<{ orgId: string | null; userId: string | null }> {
    if (projectId) {
        const { data } = await db
            .from("projects")
            .select("org_id")
            .eq("id", projectId)
            .maybeSingle();
        const orgId =
            data && typeof (data as { org_id?: unknown }).org_id === "string"
                ? (data as { org_id: string }).org_id
                : null;
        if (orgId) return { orgId, userId };
    }
    const { data: membership } = await db
        .from("org_members")
        .select("org_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
    const orgId =
        membership &&
        typeof (membership as { org_id?: unknown }).org_id === "string"
            ? (membership as { org_id: string }).org_id
            : null;
    return { orgId, userId };
}

function scopedQuery(
    db: Db,
    scope: { orgId: string | null; userId: string | null },
) {
    const query = db.from("legal_source_documents").select(
        "id, family, instrument_id, name, version_label, official_url, retrieved_via, currency_status, full_text",
    );
    return scope.orgId
        ? query.eq("org_id", scope.orgId)
        : query.eq("user_id", scope.userId).is("org_id", null);
}

const SELECT_COLS =
    "id, family, instrument_id, name, version_label, official_url, retrieved_via, currency_status, full_text";

function createScopedLegalSourceStore(
    db: Db,
    scopeP: Promise<{ orgId: string | null; userId: string | null }>,
): LegalSourceStore {
    return {
        async lookup(family, instrumentId, versionLabel) {
            const scope = await scopeP;
            let query = scopedQuery(db, scope)
                .eq("family", family)
                .eq("instrument_id", instrumentId);
            query = versionLabel
                ? query.eq("version_label", versionLabel)
                : query.is("version_label", null);
            const { data } = await query.maybeSingle();
            return data ? mapRow(data as LegalSourceRow) : null;
        },

        async lookupLatest(family, instrumentId) {
            const scope = await scopeP;
            const { data } = await scopedQuery(db, scope)
                .eq("family", family)
                .eq("instrument_id", instrumentId)
                .order("last_used_at", { ascending: false })
                .limit(1)
                .maybeSingle();
            return data ? mapRow(data as LegalSourceRow) : null;
        },

        async upsert(row) {
            const scope = await scopeP;
            const now = new Date().toISOString();
            const existing = row.versionLabel
                ? await this.lookup(row.family, row.instrumentId, row.versionLabel)
                : await this.lookup(row.family, row.instrumentId, null);
            const payload = {
                org_id: scope.orgId,
                user_id: scope.userId,
                family: row.family,
                instrument_id: row.instrumentId,
                name: row.name,
                version_label: row.versionLabel ?? null,
                official_url: row.officialUrl,
                retrieved_via: row.retrievedVia,
                currency_status: row.currencyStatus ?? "current",
                last_checked_at: now,
                last_used_at: now,
                full_text: row.fullText,
                updated_at: now,
            };
            if (existing) {
                const { data } = await db
                    .from("legal_source_documents")
                    .update(payload)
                    .eq("id", existing.id)
                    .select(SELECT_COLS)
                    .maybeSingle();
                return data ? mapRow(data as LegalSourceRow) : existing;
            }
            const { data } = await db
                .from("legal_source_documents")
                .insert(payload)
                .select(SELECT_COLS)
                .maybeSingle();
            return data ? mapRow(data as LegalSourceRow) : null;
        },

        async touch(id, patch) {
            const now = new Date().toISOString();
            await db
                .from("legal_source_documents")
                .update({
                    last_used_at: now,
                    last_checked_at: now,
                    updated_at: now,
                    ...(patch?.currencyStatus
                        ? { currency_status: patch.currencyStatus }
                        : {}),
                })
                .eq("id", id);
        },

        async update(id, patch) {
            const now = new Date().toISOString();
            const payload: Record<string, unknown> = {
                last_checked_at: now,
                updated_at: now,
            };
            if (patch.name !== undefined) payload.name = patch.name;
            if (patch.versionLabel !== undefined) {
                payload.version_label = patch.versionLabel;
            }
            if (patch.officialUrl !== undefined) {
                payload.official_url = patch.officialUrl;
            }
            if (patch.retrievedVia !== undefined) {
                payload.retrieved_via = patch.retrievedVia;
            }
            if (patch.currencyStatus !== undefined) {
                payload.currency_status = patch.currencyStatus;
            }
            if (patch.fullText !== undefined) payload.full_text = patch.fullText;
            const { data } = await db
                .from("legal_source_documents")
                .update(payload)
                .eq("id", id)
                .select(SELECT_COLS)
                .maybeSingle();
            return data ? mapRow(data as LegalSourceRow) : null;
        },
    };
}

export function createLegalSourceStore(
    db: Db,
    args: { userId: string; projectId?: string | null },
): LegalSourceStore {
    return createScopedLegalSourceStore(
        db,
        resolveScope(db, args.userId, args.projectId),
    );
}

export function createOrgLegalSourceStore(
    db: Db,
    args: { orgId: string; userId?: string | null },
): LegalSourceStore {
    return createScopedLegalSourceStore(
        db,
        Promise.resolve({ orgId: args.orgId, userId: args.userId ?? null }),
    );
}

export function legalSourceAskId(
    family: LegalSourceFamily,
    instrumentId: string,
): string {
    return `legal-source:${family}:${instrumentId}`;
}

export function parseLegalSourceAskId(
    id: string,
): { family: LegalSourceFamily; instrumentId: string } | null {
    const match = /^legal-source:([a-z_]+):(.+)$/.exec(id.trim());
    if (!match || !isFamily(match[1])) return null;
    const instrumentId = match[2].trim();
    return instrumentId ? { family: match[1], instrumentId } : null;
}

export async function resolveLegalSourceText(args: {
    store?: LegalSourceStore | null;
    family: LegalSourceFamily;
    instrumentId: string;
    name: string;
    versionLabel: string | null;
    officialUrl: string;
    fetchOfficial: () => Promise<{ fullText: string; officialUrl?: string }>;
    fetchExa?: ExaContentsFetch | null;
}): Promise<ResolvedLegalSource> {
    const store = args.store ?? null;
    if (store && args.versionLabel) {
        const held = await store.lookup(
            args.family,
            args.instrumentId,
            args.versionLabel,
        );
        if (held) {
            await store.touch(held.id, { currencyStatus: "current" });
            return {
                fullText: held.fullText,
                officialUrl: held.officialUrl || args.officialUrl,
                versionLabel: held.versionLabel,
                retrievedVia: "store",
                currencyStatus: "current",
            };
        }
    }

    let officialError: unknown;
    try {
        const official = await args.fetchOfficial();
        const fullText = official.fullText.trim();
        if (fullText) {
            const officialUrl = official.officialUrl || args.officialUrl;
            await store?.upsert({
                family: args.family,
                instrumentId: args.instrumentId,
                name: args.name,
                versionLabel: args.versionLabel,
                officialUrl,
                retrievedVia: "official",
                currencyStatus: "current",
                fullText,
            });
            return {
                fullText,
                officialUrl,
                versionLabel: args.versionLabel,
                retrievedVia: "official",
                currencyStatus: "current",
            };
        }
    } catch (err) {
        if (!inspectOfficialSourceError(err)) throw err;
        officialError = err;
    }

    if (args.fetchExa) {
        const exa = await args.fetchExa(args.officialUrl);
        const fullText = exa?.text.trim() ?? "";
        if (fullText) {
            await store?.upsert({
                family: args.family,
                instrumentId: args.instrumentId,
                name: args.name,
                versionLabel: args.versionLabel,
                officialUrl: args.officialUrl,
                retrievedVia: "exa",
                currencyStatus: "current",
                fullText,
            });
            return {
                fullText,
                officialUrl: args.officialUrl,
                versionLabel: args.versionLabel,
                retrievedVia: "exa",
                currencyStatus: "current",
            };
        }
    }

    if (store) {
        const anyHeld = await store.lookupLatest(args.family, args.instrumentId);
        if (anyHeld) {
            await store.touch(anyHeld.id, { currencyStatus: "unconfirmed" });
            return {
                fullText: anyHeld.fullText,
                officialUrl: anyHeld.officialUrl || args.officialUrl,
                versionLabel: anyHeld.versionLabel,
                retrievedVia: "store",
                currencyStatus: "unconfirmed",
            };
        }
    }

    if (officialError) throw officialError;
    throw new Error(`Could not retrieve ${args.name}.`);
}

export async function persistLegalSourceUploads(args: {
    store: LegalSourceStore;
    items: Array<{
        id: string;
        kind?: string;
        filenames?: string[];
        skipped?: boolean;
    }>;
    documents: Array<{
        filename: string;
        versionId?: string | null;
        text?: string;
    }>;
}): Promise<number> {
    let stored = 0;
    for (const item of args.items) {
        if (item.skipped) continue;
        const parsed = parseLegalSourceAskId(item.id);
        if (!parsed) continue;
        const wanted = new Set(
            (item.filenames ?? []).map((name) => name.trim().toLowerCase()),
        );
        const matches = args.documents.filter((doc) => {
            const name = doc.filename.trim().toLowerCase();
            return wanted.size === 0 || wanted.has(name);
        });
        for (const doc of matches) {
            const text =
                doc.text?.trim() ||
                (doc.versionId
                    ? ((await loadExtractedText(doc.versionId)) ?? "")
                    : "");
            if (text.length < 40) continue;
            const saved = await args.store.upsert({
                family: parsed.family,
                instrumentId: parsed.instrumentId,
                name: doc.filename.replace(/\.[^.]+$/, ""),
                versionLabel: "uploaded",
                officialUrl: `upload:${doc.filename}`,
                retrievedVia: "upload",
                currencyStatus: "unconfirmed",
                fullText: text,
            });
            if (saved) stored += 1;
        }
    }
    return stored;
}

async function loadExtractedText(versionId: string): Promise<string | null> {
    const bytes = await downloadFile(extractedTextKey(versionId));
    if (!bytes) return null;
    const text = Buffer.from(bytes).toString("utf8").trim();
    return text.length >= 40 ? text : null;
}
