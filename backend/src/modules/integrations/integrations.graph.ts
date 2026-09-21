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
    throw new Error("graph_request_failed");
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

export async function createDraftMessage(
  accessToken: string,
  args: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    htmlBody: string;
  },
): Promise<GraphMessage> {
  return graphJson<GraphMessage>(accessToken, "/me/messages", {
    method: "POST",
    body: JSON.stringify({
      subject: args.subject,
      body: { contentType: "HTML", content: args.htmlBody },
      toRecipients: recipientList(args.to),
      ccRecipients: recipientList(args.cc ?? []),
      bccRecipients: recipientList(args.bcc ?? []),
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

export async function searchMailboxMessages(
  accessToken: string,
  query: string,
): Promise<GraphMessage[]> {
  const encoded = encodeURIComponent(query);
  const data = await graphJson<{ value?: GraphMessage[] }>(
    accessToken,
    `/me/messages?$search="${encoded}"&$select=id,conversationId,internetMessageId,subject,webLink,receivedDateTime&$top=15`,
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
        body: JSON.stringify({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: attachment.filename,
          contentType: attachment.contentType,
          contentBytes: attachment.bytes.toString("base64"),
        }),
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
      body: chunk,
    });
    if (!response.ok && response.status !== 201 && response.status !== 200) {
      throw new Error("graph_request_failed");
    }
  }
}
