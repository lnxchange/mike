import { normalizeMailboxSubject } from "../../lib/emailMessage";
import { logError } from "../../lib/log";
import {
  appendOutlookSignature,
  extractOutlookSignatureHtml,
  outlookInnerHtmlFromDraftBody,
  referencedContentIds,
  wrapOutlookHtmlDocument,
} from "../../lib/outlookDraftHtml";
import type { Db } from "../../lib/supabase";
import {
  GraphAuthError,
  GraphRequestError,
  addFileAttachment,
  createDraftMessage,
  createReplyDraft,
  findMessageByInternetMessageId,
  listInlineFileAttachments,
  listRecentSentMessageBodies,
  patchDraftMessage,
  searchMailboxMessages,
} from "./integrations.graph";
import {
  deleteMicrosoftTokens,
  getGraphAccessToken,
} from "./integrations.microsoftAuth";
import {
  MAX_OUTLOOK_ATTACHMENT_BYTES,
  MAX_OUTLOOK_ATTACHMENTS,
  type CreateOutlookDraftInput,
  type GraphMessage,
  type OutlookAttachment,
  type OutlookDraftResult,
  type OutlookThreadStatus,
} from "./integrations.shared";

async function loadMailboxSignature(
  accessToken: string,
): Promise<{ html: string; images: OutlookAttachment[] } | null> {
  try {
    const sent = await listRecentSentMessageBodies(accessToken);
    for (const message of sent) {
      const html = extractOutlookSignatureHtml(message.html);
      if (!html) continue;
      const needed = referencedContentIds(html);
      const images = needed.length
        ? (await listInlineFileAttachments(accessToken, message.id)).filter(
            (attachment) =>
              attachment.contentId &&
              needed.some(
                (id) =>
                  id === attachment.contentId ||
                  id.startsWith(`${attachment.contentId}@`) ||
                  attachment.contentId.startsWith(`${id}@`),
              ),
          )
        : [];
      return { html, images };
    }
  } catch (error) {
    if (error instanceof GraphAuthError) throw error;
    logError("integrations/outlook-draft", error, { stage: "signature" });
  }
  return null;
}

function composeStagedHtml(
  rawBody: string,
  signatureHtml: string | null,
): string {
  const inner = appendOutlookSignature(
    outlookInnerHtmlFromDraftBody(rawBody),
    signatureHtml ?? "",
  );
  return wrapOutlookHtmlDocument(inner);
}

function uniqueConversationIds(messages: GraphMessage[]) {
  return [
    ...new Set(
      messages
        .map((message) => message.conversationId)
        .filter((id): id is string => !!id),
    ),
  ];
}

function newestInConversation(messages: GraphMessage[]) {
  return [...messages].sort((left, right) => {
    const leftTime = Date.parse(left.receivedDateTime ?? "") || 0;
    const rightTime = Date.parse(right.receivedDateTime ?? "") || 0;
    return rightTime - leftTime;
  })[0];
}

function mailboxSearchQuery(subject: string, participants: string[]) {
  const terms = [
    normalizeMailboxSubject(subject),
    ...participants.map((address) => address.trim()).filter(Boolean),
  ]
    .map((term) => term.replace(/["\\]/g, "").trim())
    .filter(Boolean);
  return terms.join(" AND ");
}

async function resolveThreadMessage(
  accessToken: string,
  input: CreateOutlookDraftInput,
): Promise<GraphMessage | null | "ambiguous"> {
  if (input.inReplyToInternetMessageId) {
    try {
      const exact = await findMessageByInternetMessageId(
        accessToken,
        input.inReplyToInternetMessageId,
      );
      if (exact) return exact;
    } catch (error) {
      if (error instanceof GraphAuthError) throw error;
      logError("integrations/outlook-draft", error, {
        stage: "message-id-lookup",
      });
    }
  }

  const participants = [...input.to, ...(input.cc ?? [])];
  const query = mailboxSearchQuery(input.subject, participants);
  if (!query) return null;

  try {
    const matches = await searchMailboxMessages(accessToken, query);
    if (matches.length === 0) return null;
    const conversations = uniqueConversationIds(matches);
    if (conversations.length !== 1) return "ambiguous";
    return newestInConversation(matches) ?? null;
  } catch (error) {
    if (error instanceof GraphAuthError) throw error;
    logError("integrations/outlook-draft", error, { stage: "mailbox-search" });
    return null;
  }
}

export async function createOutlookDraft(
  db: Db,
  userId: string,
  input: CreateOutlookDraftInput,
): Promise<OutlookDraftResult> {
  const attachments = input.attachments ?? [];
  if (attachments.length > MAX_OUTLOOK_ATTACHMENTS) {
    return {
      kind: "error",
      message: "A draft can attach at most 25 files.",
    };
  }
  const oversized = attachments.find(
    (attachment) => attachment.bytes.length > MAX_OUTLOOK_ATTACHMENT_BYTES,
  );
  if (oversized) {
    return {
      kind: "error",
      message: "An attached file is larger than Outlook allows.",
    };
  }

  const token = await getGraphAccessToken(db, userId);
  if (token.kind === "outlook_auth_required") return token;

  try {
    const signature = await loadMailboxSignature(token.accessToken);
    const htmlBody = composeStagedHtml(input.htmlBody, signature?.html ?? null);
    const inlineAttachments = signature?.images ?? [];
    const thread = await resolveThreadMessage(token.accessToken, input);
    let drafted: GraphMessage;
    let threaded = false;
    let threadStatus: OutlookThreadStatus = "new";
    if (thread && thread !== "ambiguous" && thread.id) {
      drafted = await createReplyDraft(token.accessToken, thread.id);
      if (!drafted.id) throw new Error("graph_request_failed");
      drafted = await patchDraftMessage(token.accessToken, drafted.id, {
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        htmlBody,
      });
      threaded = true;
      threadStatus = "matched";
    } else {
      drafted = await createDraftMessage(token.accessToken, {
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        htmlBody,
        inlineAttachments,
      });
      threadStatus = thread === "ambiguous" ? "ambiguous" : "not_found";
    }
    if (!drafted.id) throw new Error("graph_request_failed");

    if (threaded) {
      for (const image of inlineAttachments) {
        await addFileAttachment(token.accessToken, drafted.id, image);
      }
    }
    for (const attachment of attachments) {
      await addFileAttachment(token.accessToken, drafted.id, attachment);
    }

    return {
      kind: "outlook_draft_created",
      webLink: drafted.webLink ?? "",
      subject: input.subject,
      to: input.to,
      attachmentNames: attachments.map((attachment) => attachment.filename),
      threaded,
      threadStatus,
    };
  } catch (error) {
    if (error instanceof GraphAuthError) {
      if (error.invalidGrant) {
        await deleteMicrosoftTokens(db, userId).catch(() => undefined);
      }
      return { kind: "outlook_auth_required" };
    }
    logError("integrations/outlook-draft", error, {
      stage: "create",
      status: error instanceof GraphRequestError ? error.status : undefined,
      graphCode: error instanceof GraphRequestError ? error.graphCode : undefined,
      operation:
        error instanceof GraphRequestError ? error.operation : undefined,
    });
    if (error instanceof GraphRequestError && error.status === 403) {
      return {
        kind: "error",
        message:
          "Microsoft did not allow mailbox access. Reconnect Microsoft from Settings.",
      };
    }
    return {
      kind: "error",
      message: "The Outlook draft could not be created.",
    };
  }
}
