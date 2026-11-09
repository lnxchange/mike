// Search index for find_documents. The read path keeps its storage cache.
import { textlessPageCount } from "../../lib/pdfText";
import { type Db } from "../../lib/supabase";

const TEXT_CAP = 1_000_000;
const PAGE_SIZE = 20;

export type FindScope = "project" | "library" | "templates" | "document";

export type FindHit = {
    documentId: string;
    versionId: string;
    filename: string;
    storagePath: string;
    fileType: string;
    versionNumber: number | null;
    libraryKind: string;
    excerpt: string;
    textlessPageCount: number;
};

export type FindDocumentsResult = {
    hits: FindHit[];
    nextOffset: number | null;
    incomplete: boolean;
    pending: number;
    failed: number;
};

type Candidate = {
    id: string;
    current_version_id: string | null;
    library_kind: string | null;
    project_id?: string | null;
    user_id?: string | null;
    org_id?: string | null;
};

type VersionRow = {
    id: string;
    storage_path: string | null;
    file_type: string | null;
    filename: string | null;
    version_number: number | null;
    deleted_at: string | null;
};

type TextRow = {
    version_id: string;
    status: string;
    text_content: string | null;
    textless_page_count: number | null;
    source_revision?: string;
};

function missingRelation(error: unknown): boolean {
    const record =
        error && typeof error === "object"
            ? (error as { code?: unknown; message?: unknown })
            : {};
    const message = typeof record.message === "string" ? record.message : "";
    return (
        record.code === "42P01" ||
        record.code === "42703" ||
        message.includes("document_version_texts") ||
        message.includes("text_revision")
    );
}

function cleanText(text: string): string {
    return text.replace(/\u0000/g, "").slice(0, TEXT_CAP);
}

export function excerptAround(text: string, query: string): string {
    const haystack = text.toLowerCase();
    const needle = query.toLowerCase();
    const at = haystack.indexOf(needle);
    if (at < 0) return text.slice(0, 240);
    const start = Math.max(0, at - 80);
    const end = Math.min(text.length, at + query.length + 80);
    const excerpt = text.slice(start, end).replace(/\s+/g, " ").trim();
    return `${start > 0 ? "..." : ""}${excerpt}${end < text.length ? "..." : ""}`;
}

function escapeIlike(query: string): string {
    return query.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Publish extracted text for one version. A changed revision is not overwritten. */
export async function recordExtractedText(
    db: Db,
    versionId: string,
    text: string,
): Promise<void> {
    try {
        const { data, error } = await db
            .from("document_versions")
            .select("text_revision, deleted_at")
            .eq("id", versionId)
            .maybeSingle();
        if (error) {
            if (missingRelation(error)) return;
            throw error;
        }
        const version = data as
            | { text_revision?: string; deleted_at?: string | null }
            | null;
        if (!version?.text_revision || version.deleted_at) return;
        const body = cleanText(text);
        const { error: writeError } = await db
            .from("document_version_texts")
            .upsert(
                {
                    version_id: versionId,
                    source_revision: version.text_revision,
                    status: "ready",
                    text_content: body,
                    textless_page_count: textlessPageCount(body),
                    updated_at: new Date().toISOString(),
                },
                { onConflict: "version_id" },
            );
        if (writeError) {
            if (missingRelation(writeError)) return;
            throw writeError;
        }
        const { data: after } = await db
            .from("document_versions")
            .select("text_revision")
            .eq("id", versionId)
            .maybeSingle();
        const current = (after as { text_revision?: string } | null)
            ?.text_revision;
        if (current && current !== version.text_revision) {
            await db
                .from("document_version_texts")
                .update({
                    status: "pending",
                    text_content: null,
                    updated_at: new Date().toISOString(),
                })
                .eq("version_id", versionId)
                .eq("source_revision", version.text_revision);
        }
    } catch (error) {
        if (missingRelation(error)) return;
        console.warn("[document-text] extracted text was not indexed");
    }
}

async function orgIdsFor(db: Db, userId: string): Promise<string[]> {
    const { data, error } = await db
        .from("org_members")
        .select("org_id")
        .eq("user_id", userId);
    if (error) throw error;
    return ((data ?? []) as { org_id?: string }[])
        .map((row) => row.org_id)
        .filter((id): id is string => typeof id === "string");
}

async function candidates(
    db: Db,
    args: {
        userId: string;
        projectId?: string | null;
        scope: FindScope;
        documentId?: string | null;
    },
): Promise<Candidate[]> {
    let query = db
        .from("documents")
        .select(
            "id, current_version_id, library_kind, project_id, user_id, org_id",
        );
    if (args.scope === "document") {
        if (!args.documentId) return [];
        query = query.eq("id", args.documentId);
    } else if (args.scope === "project") {
        if (!args.projectId) return [];
        query = query.eq("project_id", args.projectId);
    } else {
        const orgIds = await orgIdsFor(db, args.userId);
        query = query
            .is("project_id", null)
            .eq("library_kind", args.scope === "templates" ? "template" : "file");
        query = orgIds.length
            ? query.or(
                  `user_id.eq.${args.userId},org_id.in.(${orgIds.join(",")})`,
              )
            : query.eq("user_id", args.userId);
    }
    const { data, error } = await query.limit(500);
    if (error) throw error;
    const rows = (data ?? []) as Candidate[];
    if (args.scope !== "document") return rows;
    const orgIds = new Set(await orgIdsFor(db, args.userId));
    return rows.filter((row) => {
        if (args.projectId && row.project_id === args.projectId) return true;
        if (row.project_id) return false;
        if (row.user_id === args.userId) return true;
        return typeof row.org_id === "string" && orgIds.has(row.org_id);
    });
}

export async function findDocumentPhrases(
    db: Db,
    args: {
        userId: string;
        projectId?: string | null;
        scope: FindScope;
        query: string;
        offset: number;
        documentId?: string | null;
    },
): Promise<FindDocumentsResult> {
    const query = args.query.trim();
    const found = await candidates(db, args);
    const versionIds = found
        .map((row) => row.current_version_id)
        .filter((id): id is string => typeof id === "string");
    if (!versionIds.length) {
        return {
            hits: [],
            nextOffset: null,
            incomplete: false,
            pending: 0,
            failed: 0,
        };
    }
    const { data: versionRows, error: versionError } = await db
        .from("document_versions")
        .select("id, storage_path, file_type, filename, version_number, deleted_at")
        .in("id", versionIds);
    if (versionError) throw versionError;
    const versions = new Map<string, VersionRow>();
    for (const row of (versionRows ?? []) as VersionRow[]) {
        if (!row.deleted_at && row.storage_path) versions.set(row.id, row);
    }
    const liveIds = [...versions.keys()];
    const { data: coverageRows, error: coverageError } = await db
        .from("document_version_texts")
        .select("version_id, status, textless_page_count")
        .in("version_id", liveIds);
    if (coverageError) {
        if (missingRelation(coverageError)) {
            return {
                hits: [],
                nextOffset: null,
                incomplete: true,
                pending: liveIds.length,
                failed: 0,
            };
        }
        throw coverageError;
    }
    const coverage = new Map<string, TextRow>();
    for (const row of (coverageRows ?? []) as TextRow[]) {
        coverage.set(row.version_id, row);
    }
    let pending = 0;
    let failed = 0;
    for (const versionId of liveIds) {
        const row = coverage.get(versionId);
        if (!row || row.status === "pending" || row.status === "processing") {
            pending += 1;
        } else if (row.status === "failed") failed += 1;
    }
    const { data: matchRows, error: matchError } = await db
        .from("document_version_texts")
        .select("version_id, status, text_content, textless_page_count")
        .in("version_id", liveIds)
        .eq("status", "ready")
        .ilike("text_content", `%${escapeIlike(query)}%`)
        .range(args.offset, args.offset + PAGE_SIZE);
    if (matchError) throw matchError;
    const matches = ((matchRows ?? []) as TextRow[]).filter(
        (row) => typeof row.text_content === "string",
    );
    const page = matches.slice(0, PAGE_SIZE).map((row) => ({
        versionId: row.version_id,
        text: row.text_content ?? "",
        textless: row.textless_page_count ?? 0,
    }));
    const hits: FindHit[] = [];
    for (const match of page) {
        const version = versions.get(match.versionId);
        const document = found.find(
            (row) => row.current_version_id === match.versionId,
        );
        if (!version?.storage_path || !document) continue;
        hits.push({
            documentId: document.id,
            versionId: match.versionId,
            filename: version.filename ?? "Document",
            storagePath: version.storage_path,
            fileType: version.file_type ?? "application/octet-stream",
            versionNumber: version.version_number,
            libraryKind: document.library_kind ?? "file",
            excerpt: excerptAround(match.text, query),
            textlessPageCount: match.textless,
        });
    }
    return {
        hits,
        nextOffset: matches.length > PAGE_SIZE ? args.offset + PAGE_SIZE : null,
        incomplete: pending > 0 || failed > 0,
        pending,
        failed,
    };
}

export { escapeIlike };
