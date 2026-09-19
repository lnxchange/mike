// Email messages as documents.
//
// Law firms file correspondence as .eml (RFC 822) and .msg (Outlook) files,
// and a matter is mostly its correspondence. This module turns either format
// into one normalised shape the rest of the app can work with:
//
//   - a header block plus body text for the assistant and tabular extractors
//     (`emailToText`);
//   - an HTML rendering that LibreOffice turns into the PDF the viewer shows
//     and citations anchor to (`emailToHtml`);
//   - the attachments, so the upload worker can file each one as a document
//     alongside the message (`ParsedEmail.attachments`).
//
// Parsing is in-process and cheap. Only the PDF rendering pays for a
// LibreOffice subprocess, and that happens in the upload worker, never on a
// request.

import MsgReader from "@kenjiuno/msgreader";
import { convert as htmlToText } from "html-to-text";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";

import { documentSuffix } from "./documentTypes";

export type EmailAddress = { name: string; address: string };

export type EmailAttachment = {
  filename: string;
  contentType: string;
  content: Buffer;
  /** Images and other parts referenced from the HTML body, not real files. */
  inline: boolean;
  /** An embedded message (.msg inside .msg) the parser could not expose as bytes. */
  embeddedMessage: boolean;
};

export type ParsedEmail = {
  subject: string;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  date: Date | null;
  text: string;
  html: string | null;
  attachments: EmailAttachment[];
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export async function parseEmail(
  bytes: Buffer,
  fileType: string,
): Promise<ParsedEmail> {
  const normalized = fileType.toLowerCase();
  if (normalized === "eml") return parseEml(bytes);
  if (normalized === "msg") return parseMsg(bytes);
  throw new Error(`Unsupported email type: ${fileType}`);
}

function addressList(value: AddressObject | AddressObject[] | undefined) {
  const objects = Array.isArray(value) ? value : value ? [value] : [];
  return objects.flatMap((object) =>
    object.value.map((entry) => ({
      name: entry.name?.trim() ?? "",
      address: entry.address?.trim() ?? "",
    })),
  );
}

async function parseEml(bytes: Buffer): Promise<ParsedEmail> {
  const mail: ParsedMail = await simpleParser(bytes, {
    skipImageLinks: true,
  });
  return {
    subject: mail.subject?.trim() ?? "",
    from: addressList(mail.from),
    to: addressList(mail.to),
    cc: addressList(mail.cc),
    bcc: addressList(mail.bcc),
    date: mail.date ?? null,
    text: mail.text?.trim() ?? "",
    html: typeof mail.html === "string" && mail.html.trim() ? mail.html : null,
    attachments: mail.attachments.map((attachment) => ({
      filename: attachment.filename?.trim() || "attachment",
      contentType: attachment.contentType,
      content: attachment.content,
      inline:
        attachment.contentDisposition === "inline" ||
        (!!attachment.cid && attachment.related === true),
      embeddedMessage: false,
    })),
  };
}

type MsgRecipient = {
  name?: string;
  email?: string;
  smtpAddress?: string;
  recipType?: "to" | "cc" | "bcc";
};

async function parseMsg(bytes: Buffer): Promise<ParsedEmail> {
  const reader = new MsgReader(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
  const data = reader.getFileData();
  if (data.error) throw new Error(`Outlook message could not be read: ${data.error}`);

  const recipients = (data.recipients ?? []) as MsgRecipient[];
  const byType = (type: MsgRecipient["recipType"]) =>
    recipients
      .filter((recipient) => (recipient.recipType ?? "to") === type)
      .map((recipient) => ({
        name: recipient.name?.trim() ?? "",
        address: (recipient.smtpAddress ?? recipient.email ?? "").trim(),
      }));

  let html: string | null = null;
  if (typeof data.bodyHtml === "string" && data.bodyHtml.trim()) {
    html = data.bodyHtml;
  } else if (data.html instanceof Uint8Array && data.html.byteLength > 0) {
    html = Buffer.from(data.html).toString("utf8");
  }
  let text = data.body?.trim() ?? "";
  if (!text && !html && data.compressedRtf instanceof Uint8Array) {
    text = await rtfToText(Buffer.from(data.compressedRtf));
  }

  const attachments: EmailAttachment[] = [];
  for (const attachment of data.attachments ?? []) {
    if (attachment.innerMsgContent) {
      attachments.push({
        filename:
          attachment.name?.trim() ||
          attachment.innerMsgContentFields?.subject?.trim() ||
          "Embedded message",
        contentType: "application/vnd.ms-outlook",
        content: Buffer.alloc(0),
        inline: false,
        embeddedMessage: true,
      });
      continue;
    }
    const extracted = reader.getAttachment(attachment);
    attachments.push({
      filename:
        extracted.fileName?.trim() ||
        attachment.fileName?.trim() ||
        attachment.name?.trim() ||
        "attachment",
      contentType: attachment.attachMimeTag ?? "application/octet-stream",
      content: Buffer.from(extracted.content),
      inline: !!attachment.attachmentHidden || !!attachment.pidContentId,
      embeddedMessage: false,
    });
  }

  const dateSource = data.messageDeliveryTime ?? data.clientSubmitTime;
  const date = dateSource ? new Date(dateSource) : null;

  return {
    subject: data.subject?.trim() ?? "",
    from: [
      {
        name: data.senderName?.trim() ?? "",
        address: (data.senderSmtpAddress ?? data.senderEmail ?? "").trim(),
      },
    ].filter((entry) => entry.name || entry.address),
    to: byType("to"),
    cc: byType("cc"),
    bcc: byType("bcc"),
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    text,
    html,
    attachments,
  };
}

/**
 * Last resort for Outlook messages that carry only a compressed RTF body.
 * Decompress it and strip control words. Good enough for the assistant to
 * read the message; not a faithful rendering.
 */
async function rtfToText(compressed: Buffer): Promise<string> {
  try {
    const { decompressRTF } = await import("@kenjiuno/decompressrtf");
    const rtf = Buffer.from(decompressRTF(Array.from(compressed))).toString(
      "latin1",
    );
    return rtf
      .replace(/\\par[d]?/g, "\n")
      .replace(/\\'[0-9a-f]{2}/gi, "")
      .replace(/\\[a-z]+-?\d* ?/gi, "")
      .replace(/[{}]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Attachments worth filing
// ---------------------------------------------------------------------------

/**
 * The attachments the worker should turn into sibling documents: real files
 * (not inline images), with a filename whose type the app can store. The
 * caller decides what "allowed" means so this module does not depend on the
 * upload manifest.
 */
export function fileableAttachments(
  email: ParsedEmail,
  isAllowedType: (fileType: string) => boolean,
): EmailAttachment[] {
  return email.attachments.filter(
    (attachment) =>
      !attachment.inline &&
      !attachment.embeddedMessage &&
      attachment.content.byteLength > 0 &&
      isAllowedType(documentSuffix(attachment.filename)),
  );
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function formatAddress(entry: EmailAddress): string {
  if (entry.name && entry.address && entry.name !== entry.address) {
    return `${entry.name} <${entry.address}>`;
  }
  return entry.address || entry.name;
}

function formatAddresses(entries: EmailAddress[]): string {
  return entries.map(formatAddress).filter(Boolean).join(", ");
}

function formatDate(date: Date | null): string {
  if (!date) return "";
  // Australian house style; the time zone is the server's, so include it.
  return date.toLocaleString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Body HTML from the wild is not safe to hand to LibreOffice as-is: scripts
 * are pointless, and remote images would make the converter reach out to the
 * internet during a headless conversion and stall on a dead host. Strip
 * both, keep the rest.
 */
export function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /<img\b[^>]*\bsrc\s*=\s*("(?:https?:|\/\/)[^"]*"|'(?:https?:|\/\/)[^']*')[^>]*>/gi,
      "",
    )
    .replace(/<img\b[^>]*\bsrc\s*=\s*("cid:[^"]*"|'cid:[^']*')[^>]*>/gi, "");
}

/**
 * The document the viewer shows: a header table in the style of a printed
 * email, then the body. LibreOffice reads this HTML and writes the PDF.
 */
export function emailToHtml(
  email: ParsedEmail,
  options: { importedAttachments?: string[] } = {},
): string {
  const imported = new Set(options.importedAttachments ?? []);
  const rows: [string, string][] = [
    ["From", formatAddresses(email.from)],
    ["To", formatAddresses(email.to)],
    ["Cc", formatAddresses(email.cc)],
    ["Date", formatDate(email.date)],
  ];
  const attachmentNames = email.attachments
    .filter((attachment) => !attachment.inline)
    .map((attachment) =>
      imported.has(attachment.filename)
        ? attachment.filename
        : `${attachment.filename} (not imported)`,
    );
  if (attachmentNames.length > 0) {
    rows.push(["Attachments", attachmentNames.join(", ")]);
  }

  const body = email.html
    ? sanitizeEmailHtml(email.html)
    : `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(
        email.text,
      )}</pre>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(email.subject || "(no subject)")}</title>
<style>
body { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; color: #222; }
h1 { font-size: 15pt; margin: 0 0 8pt 0; }
table.headers { border-collapse: collapse; margin-bottom: 12pt; }
table.headers th { text-align: left; padding: 1pt 10pt 1pt 0; color: #555; font-weight: normal; vertical-align: top; white-space: nowrap; }
table.headers td { padding: 1pt 0; vertical-align: top; }
hr { border: 0; border-top: 1px solid #999; margin: 0 0 12pt 0; }
</style>
</head>
<body>
<h1>${escapeHtml(email.subject || "(no subject)")}</h1>
<table class="headers">
${rows
  .filter(([, value]) => value)
  .map(
    ([label, value]) =>
      `<tr><th>${label}</th><td>${escapeHtml(value)}</td></tr>`,
  )
  .join("\n")}
</table>
<hr>
${body}
</body>
</html>
`;
}

/**
 * What the assistant and tabular extractors read: headers as labelled lines,
 * then the body as plain text, then the attachment list so the model knows
 * what travelled with the message even when a file was not imported.
 */
export function emailToText(email: ParsedEmail): string {
  const lines: string[] = [];
  const push = (label: string, value: string) => {
    if (value) lines.push(`${label}: ${value}`);
  };
  push("Subject", email.subject || "(no subject)");
  push("From", formatAddresses(email.from));
  push("To", formatAddresses(email.to));
  push("Cc", formatAddresses(email.cc));
  push("Date", formatDate(email.date));
  const attachmentNames = email.attachments
    .filter((attachment) => !attachment.inline)
    .map((attachment) => attachment.filename);
  push("Attachments", attachmentNames.join(", "));

  const body =
    email.text ||
    (email.html
      ? htmlToText(sanitizeEmailHtml(email.html), {
          wordwrap: false,
          selectors: [
            { selector: "a", options: { ignoreHref: true } },
            { selector: "img", format: "skip" },
          ],
        })
      : "");

  return `${lines.join("\n")}\n\n${body.trim()}`.trim();
}

/** Convenience for the readers: bytes in, text out. */
export async function extractEmailText(
  bytes: Buffer,
  fileType: string,
): Promise<string> {
  return emailToText(await parseEmail(bytes, fileType));
}
