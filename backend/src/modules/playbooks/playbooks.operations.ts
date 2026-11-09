import { downloadFile } from "../../lib/storage";
import { extractPdfText } from "../../lib/pdfText";
import { completeText } from "../../lib/llm";
import { getUserModelSettings } from "../user/user.service";
import { getDocument } from "../documents/documents.service";
import {
    failure,
    internalFailure,
    ok,
    type ServiceResult,
} from "../../lib/serviceResult";
import { type Db } from "../../lib/supabase";
import {
    canEdit,
    canRun,
    playbookRole,
    type PlaybookRole,
    type PlaybookRow,
} from "./playbooks.access";
import {
    emptyPlaybook,
    normalizeFindings,
    parseReviewJson,
    reviewPrompt,
    type PlaybookContent,
    type PlaybookFinding,
} from "./playbooks.review";

async function orgIds(db: Db, userId: string): Promise<Set<string>> {
    const { data, error } = await db
        .from("org_members")
        .select("org_id")
        .eq("user_id", userId);
    if (error) throw error;
    return new Set(
        ((data ?? []) as { org_id?: string }[])
            .map((row) => row.org_id)
            .filter((id): id is string => typeof id === "string"),
    );
}

async function shareRole(
    db: Db,
    playbookId: string,
    userId: string,
): Promise<"viewer" | "editor" | null> {
    const { data, error } = await db
        .from("playbook_shares")
        .select("role")
        .eq("playbook_id", playbookId)
        .eq("user_id", userId)
        .maybeSingle();
    if (error) throw error;
    const role = (data as { role?: string } | null)?.role;
    return role === "viewer" || role === "editor" ? role : null;
}

async function loadPlaybook(
    db: Db,
    playbookId: string,
): Promise<PlaybookRow | null> {
    const { data, error } = await db
        .from("playbooks")
        .select("*")
        .eq("id", playbookId)
        .maybeSingle();
    if (error) throw error;
    return (data as PlaybookRow | null) ?? null;
}

async function roleFor(
    db: Db,
    playbook: PlaybookRow,
    userId: string,
): Promise<PlaybookRole | null> {
    const [memberships, share] = await Promise.all([
        orgIds(db, userId),
        shareRole(db, playbook.id, userId),
    ]);
    return playbookRole({
        playbook,
        userId,
        orgIds: memberships,
        shareRole: share,
    });
}

export async function listPlaybooks(
    db: Db,
    userId: string,
): Promise<ServiceResult<PlaybookRow[]>> {
    try {
        const memberships = [...(await orgIds(db, userId))];
        const { data: own, error: ownError } = await db
            .from("playbooks")
            .select("*")
            .eq("user_id", userId);
        if (ownError) return internalFailure(ownError);
        const { data: shares, error: shareError } = await db
            .from("playbook_shares")
            .select("playbook_id")
            .eq("user_id", userId);
        if (shareError) return internalFailure(shareError);
        const sharedIds = ((shares ?? []) as { playbook_id: string }[]).map(
            (row) => row.playbook_id,
        );
        const { data: shared, error: sharedError } = sharedIds.length
            ? await db.from("playbooks").select("*").in("id", sharedIds)
            : { data: [], error: null };
        if (sharedError) return internalFailure(sharedError);
        const { data: visible, error: visibleError } = memberships.length
            ? await db
                  .from("playbooks")
                  .select("*")
                  .eq("visibility", "public")
                  .in("org_id", memberships)
            : { data: [], error: null };
        if (visibleError) return internalFailure(visibleError);
        const byId = new Map<string, PlaybookRow>();
        for (const row of [
            ...((own ?? []) as PlaybookRow[]),
            ...((shared ?? []) as PlaybookRow[]),
            ...((visible ?? []) as PlaybookRow[]),
        ]) {
            byId.set(row.id, row);
        }
        return ok(
            [...byId.values()].sort((a, b) =>
                b.updated_at.localeCompare(a.updated_at),
            ),
        );
    } catch (error) {
        return internalFailure(error);
    }
}

export async function createPlaybook(
    db: Db,
    userId: string,
    input: { name: string; orgId?: string | null; description?: string },
): Promise<ServiceResult<PlaybookRow>> {
    const name = input.name.trim();
    if (!name || name.length > 200) {
        return failure("validation", "A playbook needs a name.");
    }
    try {
        if (input.orgId) {
            const memberships = await orgIds(db, userId);
            if (!memberships.has(input.orgId)) {
                return failure("not_found", "Playbook not found");
            }
        }
        const { data, error } = await db
            .from("playbooks")
            .insert({
                user_id: userId,
                org_id: input.orgId ?? null,
                name,
                description: input.description?.trim() || null,
                visibility: "private",
                content: emptyPlaybook(),
            })
            .select("*")
            .single();
        if (error) return internalFailure(error);
        return ok(data as PlaybookRow);
    } catch (error) {
        return internalFailure(error);
    }
}

export async function getPlaybook(
    db: Db,
    userId: string,
    playbookId: string,
): Promise<ServiceResult<{ playbook: PlaybookRow; role: PlaybookRole }>> {
    try {
        const playbook = await loadPlaybook(db, playbookId);
        if (!playbook) return failure("not_found", "Playbook not found");
        const role = await roleFor(db, playbook, userId);
        if (!canRun(role)) return failure("not_found", "Playbook not found");
        return ok({ playbook, role: role! });
    } catch (error) {
        return internalFailure(error);
    }
}

export async function updatePlaybook(
    db: Db,
    userId: string,
    playbookId: string,
    patch: {
        name?: string;
        description?: string | null;
        visibility?: "private" | "public";
        content?: PlaybookContent;
        representedParty?: string | null;
    },
): Promise<ServiceResult<PlaybookRow>> {
    try {
        const loaded = await getPlaybook(db, userId, playbookId);
        if (!loaded.ok) return loaded;
        if (!canEdit(loaded.data.role)) {
            return failure("forbidden", "You cannot edit this playbook.");
        }
        const update: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
        };
        if (typeof patch.name === "string") {
            const name = patch.name.trim();
            if (!name || name.length > 200) {
                return failure("validation", "A playbook needs a name.");
            }
            update.name = name;
        }
        if ("description" in patch) update.description = patch.description;
        if ("representedParty" in patch) {
            update.represented_party = patch.representedParty;
        }
        if (patch.visibility) {
            if (!loaded.data.playbook.org_id) {
                return failure(
                    "validation",
                    "Only an organisation playbook can be public.",
                );
            }
            if (loaded.data.role !== "owner") {
                return failure("forbidden", "You cannot edit this playbook.");
            }
            update.visibility = patch.visibility;
        }
        if (patch.content) update.content = patch.content;
        const { data, error } = await db
            .from("playbooks")
            .update(update)
            .eq("id", playbookId)
            .select("*")
            .single();
        if (error) return internalFailure(error);
        return ok(data as PlaybookRow);
    } catch (error) {
        return internalFailure(error);
    }
}

export async function sharePlaybook(
    db: Db,
    userId: string,
    playbookId: string,
    input: { userId: string; role: "viewer" | "editor" },
): Promise<ServiceResult<{ ok: true }>> {
    try {
        const loaded = await getPlaybook(db, userId, playbookId);
        if (!loaded.ok) return loaded;
        if (loaded.data.role !== "owner") {
            return failure("forbidden", "You cannot edit this playbook.");
        }
        const { error } = await db.from("playbook_shares").upsert(
            {
                playbook_id: playbookId,
                user_id: input.userId,
                role: input.role,
            },
            { onConflict: "playbook_id,user_id" },
        );
        if (error) return internalFailure(error);
        return ok({ ok: true });
    } catch (error) {
        return internalFailure(error);
    }
}

async function contractText(
    db: Db,
    userId: string,
    userEmail: string | undefined,
    documentId: string,
): Promise<ServiceResult<string>> {
    const loaded = await getDocument(documentId, userId, userEmail, db);
    if (!loaded.ok) return failure("not_found", "Document not found");
    const versionId = loaded.doc.current_version_id;
    if (typeof versionId !== "string") {
        return failure("validation", "That document has no current version.");
    }
    const { data: indexed } = await db
        .from("document_version_texts")
        .select("text_content, status")
        .eq("version_id", versionId)
        .maybeSingle();
    const indexedText = (indexed as { text_content?: string; status?: string } | null)
        ?.text_content;
    if (
        (indexed as { status?: string } | null)?.status === "ready" &&
        indexedText
    ) {
        return ok(indexedText);
    }
    const { data: version, error } = await db
        .from("document_versions")
        .select("storage_path, file_type")
        .eq("id", versionId)
        .maybeSingle();
    if (error) return internalFailure(error);
    const path = (version as { storage_path?: string } | null)?.storage_path;
    const fileType = (
        (version as { file_type?: string } | null)?.file_type ?? ""
    ).toLowerCase();
    if (!path) return failure("validation", "That document has no file.");
    const bytes = await downloadFile(path);
    if (!bytes) return failure("unavailable", "The document could not be read.");
    if (fileType.includes("pdf")) return ok(await extractPdfText(bytes));
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return ok(result.value);
}

export async function runPlaybookReview(
    db: Db,
    args: {
        userId: string;
        userEmail?: string;
        playbookId: string;
        documentId: string;
        mode?: "strict" | "permissive";
    },
): Promise<
    ServiceResult<{ summary: string; findings: PlaybookFinding[]; runId: string }>
> {
    try {
        const loaded = await getPlaybook(db, args.userId, args.playbookId);
        if (!loaded.ok) return loaded;
        if (!canRun(loaded.data.role)) {
            return failure("not_found", "Playbook not found");
        }
        const text = await contractText(
            db,
            args.userId,
            args.userEmail,
            args.documentId,
        );
        if (!text.ok) return text;
        const content = loaded.data.playbook.content as PlaybookContent;
        const mode = args.mode === "permissive" ? "permissive" : "strict";
        const settings = await getUserModelSettings(args.userId, db);
        const model = settings.last_selected_chat_model || "claude-sonnet-5";
        const raw = await completeText({
            model,
            systemPrompt:
                "You review contracts against a playbook and return JSON only.",
            user: reviewPrompt(content, text.data, mode),
            apiKeys: settings.api_keys,
        });
        const parsed = parseReviewJson(raw);
        if (!parsed) {
            return failure("unavailable", "The review did not return findings.");
        }
        const findings = normalizeFindings(text.data, parsed.findings);
        const { data, error } = await db
            .from("playbook_runs")
            .insert({
                playbook_id: args.playbookId,
                user_id: args.userId,
                document_id: args.documentId,
                mode,
                summary: parsed.summary,
                findings,
            })
            .select("id")
            .single();
        if (error) return internalFailure(error);
        return ok({
            summary: parsed.summary,
            findings,
            runId: (data as { id: string }).id,
        });
    } catch (error) {
        return internalFailure(error);
    }
}

export async function compilePlaybook(
    db: Db,
    userId: string,
    input: { name: string; orgId?: string | null; sourceText: string },
): Promise<ServiceResult<PlaybookRow>> {
    const source = input.sourceText.trim();
    if (source.length < 20) {
        return failure("validation", "Paste or supply the negotiation guide.");
    }
    try {
        const settings = await getUserModelSettings(userId, db);
        const model = settings.last_selected_chat_model || "claude-sonnet-5";
        const raw = await completeText({
            model,
            systemPrompt:
                "Turn a negotiation guide into playbook rules. Return JSON only.",
            user: `Return {"rules":[{"id":"rule-1","name":"","concept":"","required":true,"standard":"","fallbacks":[],"unacceptable":[],"guidance":""}]}. Use verbatim only when the source requires exact wording. Keep uncertain material in guidance.\n\nGUIDE:\n${source.slice(0, 100_000)}`,
            apiKeys: settings.api_keys,
        });
        const created = await createPlaybook(db, userId, input);
        if (!created.ok) return created;
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start < 0 || end <= start) return created;
        try {
            const parsed = JSON.parse(raw.slice(start, end + 1)) as {
                rules?: PlaybookContent["rules"];
            };
            if (!Array.isArray(parsed.rules) || !parsed.rules.length) {
                return created;
            }
            return updatePlaybook(db, userId, created.data.id, {
                content: { rules: parsed.rules },
            });
        } catch {
            return created;
        }
    } catch (error) {
        return internalFailure(error);
    }
}
