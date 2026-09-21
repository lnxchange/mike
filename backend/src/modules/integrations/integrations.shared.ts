export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
export const TOKEN_ENDPOINT =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";

export const MAX_OUTLOOK_ATTACHMENTS = 25;
export const MAX_OUTLOOK_ATTACHMENT_BYTES = 140 * 1024 * 1024;
export const SIMPLE_ATTACHMENT_BYTES = 3 * 1024 * 1024;

export type MicrosoftTokenRow = {
  user_id: string;
  encrypted_access_token: string;
  access_token_iv: string;
  access_token_tag: string;
  encrypted_refresh_token: string;
  refresh_token_iv: string;
  refresh_token_tag: string;
  access_token_expires_at: string;
  granted_scopes: string;
  mailbox_upn: string | null;
};

export type PersistMicrosoftTokensInput = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  grantedScopes: string;
  mailboxUpn?: string | null;
};

export type OutlookAuthRequired = {
  kind: "outlook_auth_required";
};

export type OutlookThreadStatus =
  | "matched"
  | "ambiguous"
  | "not_found"
  | "new";

export type OutlookDraftSuccess = {
  kind: "outlook_draft_created";
  webLink: string;
  subject: string;
  to: string[];
  attachmentNames: string[];
  threaded: boolean;
  threadStatus: OutlookThreadStatus;
};

export type OutlookDraftFailure = {
  kind: "error";
  message: string;
};

export type OutlookDraftResult =
  | OutlookDraftSuccess
  | OutlookAuthRequired
  | OutlookDraftFailure;

export type OutlookAttachment = {
  filename: string;
  contentType: string;
  bytes: Buffer;
};

export type CreateOutlookDraftInput = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  htmlBody: string;
  attachments?: OutlookAttachment[];
  inReplyToInternetMessageId?: string | null;
};

export type GraphMessage = {
  id?: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  webLink?: string;
  receivedDateTime?: string;
};
