import { logError } from "../../lib/log";
import {
  GRAPH_BASE,
  SIMPLE_ATTACHMENT_BYTES,
  TOKEN_ENDPOINT,
  type GraphMessage,
  type OutlookAttachment,
} from "./integrations.shared";

export class GraphAuthError extends Error {
  readonly invalidGrant: boolean;
  constructor(message: string, invalidGrant = false) {
    super(message);
    this.name = "GraphAuthError";
    this.invalidGrant = invalidGrant;
  }
}

export class GraphRequestError extends Error {
  readonly status: number;
  readonly graphCode: string | null;
  readonly operation: string;
  constructor(status: number, graphCode: string | null, operation: string) {
    super("graph_request_failed");
    this.name = "GraphRequestError";
    this.status = status;
    this.graphCode = graphCode;
    this.operation = operation;
  }
}

/** Graph $search is one quoted string. Inner quotes are stripped, not nested. */
export function graphSearchParameter(query: string): string {
  return `"${query.replace(/"/g, "").trim()}"`;
}

function graphOperation(path: string): string {
  const bare = path.split("?")[0] ?? path;
  return bare.replace(/\/messages\/[^/]+/g, "/messages/*");
}

function graphErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as { error?: { code?: unknown } }).error;
  if (!error || typeof error !== "object") return null;
  return typeof error.code === "string" ? error.code : null;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
};

export async function refreshMicrosoftTokens(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  scopes: string;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  grantedScopes: string;
}> {
  const body = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    scope: args.scopes,
  });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new GraphAuthError(
      "Microsoft authorization expired",
      payload.error === "invalid_grant" || response.status === 400,
    );
  }
  const expiresIn =
    typeof payload.expires_in === "number" && payload.expires_in > 0
      ? payload.expires_in
      : 3600;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? args.refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    grantedScopes: payload.scope ?? args.scopes,
  };
}

async function graphFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body && !(init.body instanceof Buffer)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
}

export async function graphJson<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await graphFetch(accessToken, path, init);
  if (response.status === 401) {
    throw new GraphAuthError("Microsoft authorization expired", true);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const graphCode = graphErrorCode(payload);
    const operation = graphOperation(path);
    logError("integrations/graph", "graph_request_failed", {
      status: response.status,
      graphCode,
      operation,
    });
    throw new GraphRequestError(response.status, graphCode, operation);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function getMailboxUpn(accessToken: string): Promise<string | null> {
  const me = await graphJson<{ userPrincipalName?: string; mail?: string }>(
    accessToken,
    "/me?$select=userPrincipalName,mail",
  );
  return me.userPrincipalName ?? me.mail ?? null;
}

function recipientList(addresses: string[]) {
  return addresses
    .map((address) => address.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

function fileAttachmentPayload(attachment: OutlookAttachment) {
  return {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: attachment.filename,
    contentType: attachment.contentType,
    contentBytes: attachment.bytes.toString("base64"),
    ...(attachment.isInline
      ? { isInline: true, contentId: attachment.contentId }
      : {}),
  };
}

export async function createDraftMessage(
  accessToken: string,
  args: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    htmlBody: string;
    inlineAttachments?: OutlookAttachment[];
  },
): Promise<GraphMessage> {
  const inline = (args.inlineAttachments ?? []).filter(
    (attachment) => attachment.isInline && attachment.contentId,
  );
  return graphJson<GraphMessage>(accessToken, "/me/messages", {
    method: "POST",
    body: JSON.stringify({
      subject: args.subject,
      body: { contentType: "HTML", content: args.htmlBody },
      toRecipients: recipientList(args.to),
      ccRecipients: recipientList(args.cc ?? []),
      bccRecipients: recipientList(args.bcc ?? []),
      ...(inline.length ? { attachments: inline.map(fileAttachmentPayload) } : {}),
    }),
  });
}

export async function createReplyDraft(
  accessToken: string,
  messageId: string,
): Promise<GraphMessage> {
  return graphJson<GraphMessage>(
    accessToken,
    `/me/messages/${encodeURIComponent(messageId)}/createReply`,
    { method: "POST" },
  );
}

export async function patchDraftMessage(
  accessToken: string,
  messageId: string,
  args: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    htmlBody: string;
  },
): Promise<GraphMessage> {
  return graphJson<GraphMessage>(
    accessToken,
    `/me/messages/${encodeURIComponent(messageId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        subject: args.subject,
        body: { contentType: "HTML", content: args.htmlBody },
        toRecipients: recipientList(args.to),
        ccRecipients: recipientList(args.cc ?? []),
        bccRecipients: recipientList(args.bcc ?? []),
      }),
    },
  );
}

export async function findMessageByInternetMessageId(
  accessToken: string,
  internetMessageId: string,
): Promise<GraphMessage | null> {
  const quoted = internetMessageId.replace(/'/g, "''");
  const data = await graphJson<{ value?: GraphMessage[] }>(
    accessToken,
    `/me/messages?$filter=internetMessageId eq '${quoted}'&$select=id,conversationId,internetMessageId,subject,webLink,receivedDateTime&$top=5`,
  );
  return data.value?.[0] ?? null;
}

export async function listRecentSentMessageBodies(
  accessToken: string,
): Promise<{ id: string; html: string }[]> {
  const params = new URLSearchParams({
    $select: "id,uniqueBody,body",
    $orderby: "sentDateTime desc",
    $top: "8",
  });
  const data = await graphJson<{
    value?: {
      id?: string;
      uniqueBody?: { content?: string; contentType?: string };
      body?: { content?: string; contentType?: string };
    }[];
  }>(accessToken, `/me/mailFolders/sentitems/messages?${params.toString()}`, {
    headers: { Prefer: 'outlook.body-content-type="html"' },
  });
  return (data.value ?? [])
    .map((message) => {
      // uniqueBody is the conversation diff. A signature that is on every
      // message is not unique, so it is missing there. The full body still has it.
      const html =
        message.body?.content?.trim() ||
        message.uniqueBody?.content?.trim() ||
        "";
      return message.id && html ? { id: message.id, html } : null;
    })
    .filter((message): message is { id: string; html: string } => !!message);
}

export async function getMessageHtml(
  accessToken: string,
  messageId: string,
): Promise<string | null> {
  const data = await graphJson<{ body?: { content?: string } }>(
    accessToken,
    `/me/messages/${encodeURIComponent(messageId)}?$select=body`,
    { headers: { Prefer: 'outlook.body-content-type="html"' } },
  );
  const html = data.body?.content?.trim();
  return html || null;
}

export async function listInlineFileAttachments(
  accessToken: string,
  messageId: string,
): Promise<OutlookAttachment[]> {
  const data = await graphJson<{
    value?: {
      name?: string;
      contentType?: string;
      contentId?: string;
      isInline?: boolean;
      contentBytes?: string;
    }[];
  }>(
    accessToken,
    `/me/messages/${encodeURIComponent(messageId)}/attachments?$select=name,contentType,contentId,isInline,contentBytes`,
  );
  const attachments: OutlookAttachment[] = [];
  for (const attachment of data.value ?? []) {
    const contentId = attachment.contentId?.replace(/^<|>$/g, "").trim();
    if (!attachment.isInline || !contentId || !attachment.contentBytes) {
      continue;
    }
    attachments.push({
      filename: attachment.name || contentId,
      contentType: attachment.contentType || "application/octet-stream",
      bytes: Buffer.from(attachment.contentBytes, "base64"),
      isInline: true,
      contentId,
    });
  }
  return attachments;
}

export async function searchMailboxMessages(
  accessToken: string,
  query: string,
): Promise<GraphMessage[]> {
  const params = new URLSearchParams({
    $search: graphSearchParameter(query),
    $select:
      "id,conversationId,internetMessageId,subject,webLink,receivedDateTime",
    $top: "15",
  });
  const data = await graphJson<{ value?: GraphMessage[] }>(
    accessToken,
    `/me/messages?${params.toString()}`,
    { headers: { ConsistencyLevel: "eventual" } },
  );
  return data.value ?? [];
}

export async function addFileAttachment(
  accessToken: string,
  messageId: string,
  attachment: OutlookAttachment,
): Promise<void> {
  if (attachment.bytes.length <= SIMPLE_ATTACHMENT_BYTES) {
    await graphJson(
      accessToken,
      `/me/messages/${encodeURIComponent(messageId)}/attachments`,
      {
        method: "POST",
        body: JSON.stringify(fileAttachmentPayload(attachment)),
      },
    );
    return;
  }

  const session = await graphJson<{ uploadUrl?: string }>(
    accessToken,
    `/me/messages/${encodeURIComponent(messageId)}/attachments/createUploadSession`,
    {
      method: "POST",
      body: JSON.stringify({
        AttachmentItem: {
          attachmentType: "file",
          name: attachment.filename,
          size: attachment.bytes.length,
        },
      }),
    },
  );
  if (!session.uploadUrl) throw new Error("graph_request_failed");

  const chunkSize = 4 * 1024 * 1024;
  for (let start = 0; start < attachment.bytes.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, attachment.bytes.length);
    const chunk = attachment.bytes.subarray(start, end);
    const response = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${start}-${end - 1}/${attachment.bytes.length}`,
      },
      body: new Uint8Array(chunk),
    });
    if (!response.ok && response.status !== 201 && response.status !== 200) {
      throw new Error("graph_request_failed");
    }
  }
}
