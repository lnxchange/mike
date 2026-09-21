import { normalizeMailboxSubject } from "../../lib/emailMessage";
import type { Db } from "../../lib/supabase";
import { GraphAuthError } from "./integrations.graph";
import {
  addFileAttachment,
  createDraftMessage,
  createReplyDraft,
  findMessageByInternetMessageId,
  patchDraftMessage,
  searchMailboxMessages,
} from "./integrations.graph";
import { getGraphAccessToken } from "./integrations.microsoftAuth";
import {
  MAX_OUTLOOK_ATTACHMENT_BYTES,
  MAX_OUTLOOK_ATTACHMENTS,
  type CreateOutlookDraftInput,
  type GraphMessage,
  type OutlookDraftResult,
} from "./integrations.shared";

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
  ].filter(Boolean);
  return terms.map((term) => `"${term.replace(/"/g, "")}"`).join(" AND ");
}

async function resolveThreadMessage(
  accessToken: string,
  input: CreateOutlookDraftInput,
): Promise<GraphMessage | null | "ambiguous"> {
  if (input.inReplyToInternetMessageId) {
    const exact = await findMessageByInternetMessageId(
      accessToken,
      input.inReplyToInternetMessageId,
    );
    if (exact) return exact;
  }

  const participants = [...input.to, ...(input.cc ?? [])];
  const query = mailboxSearchQuery(input.subject, participants);
  if (!query) return null;

  const matches = await searchMailboxMessages(accessToken, query);
  if (matches.length === 0) return null;
  const conversations = uniqueConversationIds(matches);
  if (conversations.length !== 1) return "ambiguous";
  return newestInConversation(matches) ?? null;
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
    const thread = await resolveThreadMessage(token.accessToken, input);
    let drafted: GraphMessage;
    let threaded = false;
    if (thread && thread !== "ambiguous" && thread.id) {
      drafted = await createReplyDraft(token.accessToken, thread.id);
      if (!drafted.id) throw new Error("graph_request_failed");
      drafted = await patchDraftMessage(token.accessToken, drafted.id, {
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        htmlBody: input.htmlBody,
      });
      threaded = true;
    } else {
      drafted = await createDraftMessage(token.accessToken, {
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        htmlBody: input.htmlBody,
      });
    }
    if (!drafted.id) throw new Error("graph_request_failed");

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
    };
  } catch (error) {
    if (error instanceof GraphAuthError) {
      return { kind: "outlook_auth_required" };
    }
    return {
      kind: "error",
      message: "The Outlook draft could not be created.",
    };
  }
}
