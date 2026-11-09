import { logError } from "../../lib/log";
import {
  embedSignatureImages,
  extractOutlookSignatureHtml,
  materializeStoredSignature,
  MAX_STORED_SIGNATURE_CHARS,
  referencedContentIds,
  sanitizeStoredSignatureHtml,
} from "../../lib/outlookDraftHtml";
import {
  failure,
  internalFailure,
  ok,
  type ServiceResult,
} from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import {
  GraphAuthError,
  listInlineFileAttachments,
  listRecentSentMessageBodies,
} from "./integrations.graph";
import { getGraphAccessToken } from "./integrations.microsoftAuth";
import type { OutlookAttachment } from "./integrations.shared";

export type MailboxSignature = {
  html: string;
  images: OutlookAttachment[];
};

function matchingInlineImages(
  needed: string[],
  attachments: OutlookAttachment[],
): OutlookAttachment[] {
  if (!needed.length) return [];
  return attachments.filter((attachment) => {
    const contentId = attachment.contentId;
    if (!contentId) return false;
    return needed.some(
      (id) =>
        id === contentId ||
        id.startsWith(`${contentId}@`) ||
        contentId.startsWith(`${id}@`),
    );
  });
}

export async function signatureFromHtml(
  accessToken: string,
  messageId: string,
  rawHtml: string,
): Promise<MailboxSignature | null> {
  const html = extractOutlookSignatureHtml(rawHtml);
  if (!html) return null;
  const needed = referencedContentIds(html);
  const images = needed.length
    ? matchingInlineImages(
        needed,
        await listInlineFileAttachments(accessToken, messageId),
      )
    : [];
  return { html, images };
}

async function loadMailboxSignature(
  accessToken: string,
): Promise<MailboxSignature | null> {
  try {
    const sent = await listRecentSentMessageBodies(accessToken);
    for (const message of sent) {
      const signature = await signatureFromHtml(
        accessToken,
        message.id,
        message.html,
      );
      if (signature) return signature;
    }
  } catch (error) {
    if (error instanceof GraphAuthError) throw error;
    logError("integrations/outlook-signature", error, { stage: "mailbox" });
  }
  return null;
}

export async function loadSavedOutlookSignature(
  db: Db,
  userId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("user_outlook_signatures")
    .select("html")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const html = data?.html;
  return typeof html === "string" && html.trim() ? html : null;
}

export async function saveOutlookSignatureHtml(
  db: Db,
  userId: string,
  html: string,
): Promise<void> {
  const { error } = await db.from("user_outlook_signatures").upsert(
    {
      user_id: userId,
      html,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

async function clearOutlookSignature(db: Db, userId: string): Promise<void> {
  const { error } = await db
    .from("user_outlook_signatures")
    .delete()
    .eq("user_id", userId);
  if (error) throw error;
}

export async function rememberOutlookSignature(
  db: Db,
  userId: string,
  signature: MailboxSignature,
): Promise<void> {
  try {
    await saveOutlookSignatureHtml(
      db,
      userId,
      embedSignatureImages(signature.html, signature.images),
    );
  } catch (error) {
    logError("integrations/outlook-signature", error, { stage: "save" });
  }
}

function stagedFromStored(html: string): MailboxSignature {
  const staged = materializeStoredSignature(html);
  return { html: staged.html, images: staged.images };
}

/** Saved account signature, or the first capture from sent mail. */
export async function savedOrCapturedSignature(
  db: Db,
  userId: string,
  accessToken: string,
): Promise<MailboxSignature | null> {
  try {
    const saved = await loadSavedOutlookSignature(db, userId);
    if (saved) return stagedFromStored(saved);
  } catch (error) {
    logError("integrations/outlook-signature", error, { stage: "load" });
  }
  const captured = await loadMailboxSignature(accessToken);
  if (!captured) return null;
  await rememberOutlookSignature(db, userId, captured);
  return captured;
}

export async function getOutlookSignature(
  db: Db,
  userId: string,
): Promise<ServiceResult<{ html: string | null }>> {
  try {
    const html = await loadSavedOutlookSignature(db, userId);
    return ok({ html });
  } catch (error) {
    logError("integrations/outlook-signature", error, { stage: "read" });
    return internalFailure(error);
  }
}

export async function updateOutlookSignature(
  db: Db,
  userId: string,
  html: unknown,
): Promise<ServiceResult<{ html: string | null }>> {
  if (typeof html !== "string") {
    return failure("validation", "Enter the signature as text.");
  }
  if (html.length > MAX_STORED_SIGNATURE_CHARS) {
    return failure("validation", "The signature is too long.");
  }
  const clean = sanitizeStoredSignatureHtml(html);
  if (!clean) {
    try {
      await clearOutlookSignature(db, userId);
      return ok({ html: null });
    } catch (error) {
      logError("integrations/outlook-signature", error, { stage: "clear" });
      return internalFailure(error);
    }
  }
  if (clean.length > MAX_STORED_SIGNATURE_CHARS) {
    return failure("validation", "The signature is too long.");
  }
  const staged = materializeStoredSignature(clean);
  if (staged.rejected) {
    return failure(
      "validation",
      "One of the signature images is too large to keep.",
    );
  }
  try {
    await saveOutlookSignatureHtml(db, userId, clean);
    return ok({ html: clean });
  } catch (error) {
    logError("integrations/outlook-signature", error, { stage: "update" });
    return internalFailure(error);
  }
}

export async function refreshOutlookSignature(
  db: Db,
  userId: string,
): Promise<ServiceResult<{ html: string }>> {
  const token = await getGraphAccessToken(db, userId);
  if (token.kind === "outlook_auth_required") {
    return failure(
      "conflict",
      "Connect Microsoft in Settings to copy your signature.",
      "outlook_auth_required",
    );
  }
  try {
    const captured = await loadMailboxSignature(token.accessToken);
    if (!captured) {
      return failure(
        "not_found",
        "No signature was found in your recent sent mail. You can paste one here instead.",
      );
    }
    const html = embedSignatureImages(captured.html, captured.images);
    await saveOutlookSignatureHtml(db, userId, html);
    return ok({ html });
  } catch (error) {
    if (error instanceof GraphAuthError) {
      return failure(
        "conflict",
        "Connect Microsoft in Settings to copy your signature.",
        "outlook_auth_required",
      );
    }
    logError("integrations/outlook-signature", error, { stage: "refresh" });
    return internalFailure(error);
  }
}
