// Stages the email already shown on a draft card. The model is not called
// again, so the Outlook draft is the text the user has already read.
import type { OutlookDraftCreatedEvent } from "@mike/contracts";
import { logError } from "../../lib/log";
import { contentTypeForDocumentType } from "../../lib/documentTypes";
import type { Db } from "../../lib/supabase";
import { getDocument } from "../documents/documents.service";
import { createOutlookDraft } from "../integrations/integrations.service";
import { loadCurrentVersionBytes } from "./engine/tools/documentOps";

export type StageOutlookPreviewResult =
    | { ok: true; event: OutlookDraftCreatedEvent }
    | { ok: false; kind: "not_found" }
    | { ok: false; kind: "no_preview" }
    | { ok: false; kind: "outlook_auth_required" }
    | { ok: false; kind: "attachment_unavailable" }
    | { ok: false; kind: "error"; message: string };

function stringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
}

function suffix(filename: string): string {
    const dot = filename.lastIndexOf(".");
    return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

function asCreatedEvent(value: unknown): OutlookDraftCreatedEvent | null {
    if (!value || typeof value !== "object") return null;
    const event = value as Record<string, unknown>;
    if (event.type !== "outlook_draft_created") return null;
    if (typeof event.subject !== "string" || typeof event.web_link !== "string") {
        return null;
    }
    return event as unknown as OutlookDraftCreatedEvent;
}

export async function stageOutlookPreview(
    db: Db,
    args: {
        chatId: string;
        messageId: string;
        userId: string;
        userEmail: string | undefined;
        eventIndex: number | null;
    },
): Promise<StageOutlookPreviewResult> {
    const { data, error } = await db
        .from("chat_messages")
        .select("id, role, content")
        .eq("id", args.messageId)
        .eq("chat_id", args.chatId)
        .maybeSingle();
    if (error) {
        logError("chat/outlook-draft", error, { stage: "load" });
        return {
            ok: false,
            kind: "error",
            message: "The draft could not be staged. Please try again.",
        };
    }
    const row = data as {
        role?: unknown;
        content?: unknown;
    } | null;
    if (!row || row.role !== "assistant" || !Array.isArray(row.content)) {
        return { ok: false, kind: "not_found" };
    }

    const events = row.content as unknown[];
    let previewIndex = -1;
    if (
        args.eventIndex != null &&
        args.eventIndex >= 0 &&
        args.eventIndex < events.length
    ) {
        const chosen = events[args.eventIndex] as { type?: unknown } | null;
        if (chosen?.type === "outlook_draft_preview") previewIndex = args.eventIndex;
        const already = asCreatedEvent(chosen);
        if (already) return { ok: true, event: already };
    }
    if (previewIndex < 0 && args.eventIndex == null) {
        for (let index = events.length - 1; index >= 0; index -= 1) {
            const event = events[index] as { type?: unknown } | null;
            if (event?.type === "outlook_draft_preview") {
                previewIndex = index;
                break;
            }
        }
    }
    if (previewIndex < 0) {
        for (let index = events.length - 1; index >= 0; index -= 1) {
            const created = asCreatedEvent(events[index]);
            if (created) return { ok: true, event: created };
        }
        return { ok: false, kind: "no_preview" };
    }

    const preview = events[previewIndex] as Record<string, unknown>;
    const subject = typeof preview.subject === "string" ? preview.subject.trim() : "";
    const htmlBody = typeof preview.html_body === "string" ? preview.html_body : "";
    const to = stringList(preview.to);
    const cc = stringList(preview.cc);
    const bcc = stringList(preview.bcc);
    const attachmentNames = stringList(preview.attachment_names);
    const attachmentDocumentIds = stringList(preview.attachment_document_ids);
    const inReplyTo =
        typeof preview.in_reply_to_internet_message_id === "string"
            ? preview.in_reply_to_internet_message_id
            : null;
    if (!subject || !htmlBody || to.length === 0) {
        return { ok: false, kind: "no_preview" };
    }
    if (
        attachmentNames.length > 0 &&
        attachmentDocumentIds.length !== attachmentNames.length
    ) {
        return { ok: false, kind: "attachment_unavailable" };
    }

    const attachments: {
        filename: string;
        contentType: string;
        bytes: Buffer;
    }[] = [];
    for (let index = 0; index < attachmentDocumentIds.length; index += 1) {
        const documentId = attachmentDocumentIds[index];
        const access = await getDocument(
            documentId,
            args.userId,
            args.userEmail,
            db,
        );
        if (!access.ok) return { ok: false, kind: "attachment_unavailable" };
        const loaded = await loadCurrentVersionBytes(documentId, db);
        if (!loaded) return { ok: false, kind: "attachment_unavailable" };
        const filename =
            attachmentNames[index] ||
            (typeof access.doc.filename === "string" ? access.doc.filename : "attachment");
        attachments.push({
            filename,
            contentType: contentTypeForDocumentType(suffix(filename)),
            bytes: loaded.bytes,
        });
    }

    const result = await createOutlookDraft(db, args.userId, {
        to,
        cc,
        bcc,
        subject,
        htmlBody,
        attachments,
        inReplyToInternetMessageId: inReplyTo,
    });
    if (result.kind === "outlook_auth_required") {
        return { ok: false, kind: "outlook_auth_required" };
    }
    if (result.kind === "error") {
        return { ok: false, kind: "error", message: result.message };
    }

    const event: OutlookDraftCreatedEvent = {
        type: "outlook_draft_created",
        web_link: result.webLink,
        subject: result.subject,
        to: result.to,
        cc: cc.length > 0 ? cc : undefined,
        html_body: htmlBody,
        attachment_names: result.attachmentNames,
        threaded: result.threaded,
        thread_status: result.threadStatus,
    };
    const next = events.slice();
    next[previewIndex] = event;
    const { error: saveError } = await db
        .from("chat_messages")
        .update({ content: next })
        .eq("id", args.messageId)
        .eq("chat_id", args.chatId);
    if (saveError) {
        logError("chat/outlook-draft", saveError, { stage: "save" });
    }
    return { ok: true, event };
}
