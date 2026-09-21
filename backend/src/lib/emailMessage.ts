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

const MESSAGE_ID_HEADER =
  /(?:^|\n)message-id:\s*(?:[ \t]*\r?\n[ \t]+)*([^\r\n]+)/i;

export function normalizeInternetMessageId(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const angled = trimmed.startsWith("<") ? trimmed : `<${trimmed}>`;
  return angled.length <= 998 ? angled : null;
}

export function extractInternetMessageId(
  bytes: Buffer | string,
  fileType?: string | null,
): string | null {
  const normalized = (fileType ?? "").toLowerCase();
  if (normalized && normalized !== "eml" && normalized !== "msg") return null;
  const text =
    typeof bytes === "string"
      ? bytes
      : bytes.subarray(0, Math.min(bytes.length, 64 * 1024)).toString("latin1");
  const match = MESSAGE_ID_HEADER.exec(text.replace(/\r\n/g, "\n"));
  if (!match) return null;
  return normalizeInternetMessageId(match[1]);
}

export function normalizeMailboxSubject(subject: string | null | undefined) {
  if (!subject) return "";
  return subject
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type EmailAddress = { name: string; address: string };

export type EmailAttachment = {
  filename: string;
  contentType: string;
  content: Buffer;
  /** Images and other parts referenced from the HTML body, not real files. */
  inline: boolean;
  /** Content-ID without angle brackets, used to inline signature images. */
  cid: string | null;
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
  /** RFC 822 Message-ID, including angle brackets when present. */
  messageId: string | null;
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
    messageId:
      normalizeInternetMessageId(mail.messageId) ??
      extractInternetMessageId(bytes, "eml"),
    text: mail.text?.trim() ?? "",
    html: typeof mail.html === "string" && mail.html.trim() ? mail.html : null,
    attachments: mail.attachments.map((attachment) => ({
      filename: attachment.filename?.trim() || "attachment",
      contentType: attachment.contentType,
      content: attachment.content,
      inline:
        attachment.contentDisposition === "inline" ||
        (!!attachment.cid && attachment.related === true),
      cid: normalizeCid(attachment.cid),
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

  const codepage = data.internetCodepage ?? data.messageCodepage;
  let html: string | null = null;
  if (typeof data.bodyHtml === "string" && data.bodyHtml.trim()) {
    html = data.bodyHtml;
  } else if (data.html instanceof Uint8Array && data.html.byteLength > 0) {
    html = decodeMsgHtml(data.html, codepage);
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
        cid: null,
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
      cid: normalizeCid(attachment.pidContentId),
      embeddedMessage: false,
    });
  }

  const dateSource = data.messageDeliveryTime ?? data.clientSubmitTime;
  const date = dateSource ? new Date(dateSource) : null;

  const rawMessageId =
    typeof (data as { internetMessageId?: unknown }).internetMessageId ===
    "string"
      ? (data as { internetMessageId?: string }).internetMessageId
      : null;

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
    messageId:
      normalizeInternetMessageId(rawMessageId) ??
      extractInternetMessageId(bytes, "msg"),
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
    const windows1252 = new TextDecoder("windows-1252");
    return rtf
      .replace(/\\par[d]?/g, "\n")
      .replace(/\\'([0-9a-f]{2})/gi, (_match, hex: string) =>
        windows1252.decode(Uint8Array.of(Number.parseInt(hex, 16))),
      )
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

/** Content-ID without the angle brackets Outlook often wraps it in. */
function normalizeCid(value: string | undefined | null): string | null {
  const cid = value?.replace(/^<|>$/g, "").trim();
  return cid || null;
}

/**
 * Outlook stores HTML bytes under a Windows code page. Decoding them as
 * UTF-8 produces the â€™ / Ã© mojibake that then lands in the PDF.
 */
function decodeMsgHtml(
  bytes: Uint8Array,
  codepage: number | undefined,
): string {
  const labels = [
    internetCodepageLabel(codepage),
    "windows-1252",
    "utf-8",
  ].filter((label, index, all): label is string => {
    return !!label && all.indexOf(label) === index;
  });
  for (const label of labels) {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // Try the next label; Node's ICU build may not know every code page.
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function internetCodepageLabel(codepage: number | undefined): string | null {
  switch (codepage) {
    case 65001:
      return "utf-8";
    case 1200:
      return "utf-16le";
    case 1201:
      return "utf-16be";
    case 1250:
      return "windows-1250";
    case 1251:
      return "windows-1251";
    case 1252:
      return "windows-1252";
    case 1253:
      return "windows-1253";
    case 1254:
      return "windows-1254";
    case 1255:
      return "windows-1255";
    case 1256:
      return "windows-1256";
    case 1257:
      return "windows-1257";
    case 1258:
      return "windows-1258";
    case 28591:
      return "iso-8859-1";
    case 28592:
      return "iso-8859-2";
    case 28595:
      return "iso-8859-5";
    case 28597:
      return "iso-8859-7";
    case 28599:
      return "iso-8859-9";
    case 28605:
      return "iso-8859-15";
    case 932:
      return "shift_jis";
    case 936:
      return "gbk";
    case 949:
      return "euc-kr";
    case 950:
      return "big5";
    default:
      return null;
  }
}

/** Inline images larger than this stay out of the HTML; they are not signatures. */
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Replace cid: image references with data URIs from the message parts so
 * LibreOffice can draw the signature without fetching anything.
 */
export function inlineCidImages(
  html: string,
  attachments: EmailAttachment[],
): string {
  const byCid = new Map<string, EmailAttachment>();
  for (const attachment of attachments) {
    if (
      !attachment.cid ||
      attachment.content.byteLength === 0 ||
      attachment.content.byteLength > MAX_INLINE_IMAGE_BYTES
    ) {
      continue;
    }
    const cid = attachment.cid.toLowerCase();
    byCid.set(cid, attachment);
    const local = cid.split("@")[0];
    if (local && !byCid.has(local)) byCid.set(local, attachment);
  }
  if (byCid.size === 0) return html;

  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const match = tag.match(
      /\bsrc\s*=\s*(?:["']cid:([^"']+)["']|cid:([^\s>]+))/i,
    );
    if (!match) return tag;
    const raw = (match[1] ?? match[2] ?? "").replace(/^<|>$/g, "").trim();
    const key = raw.toLowerCase();
    const attachment =
      byCid.get(key) ?? byCid.get(key.split("@")[0] ?? "");
    if (!attachment) return tag;
    const mime = attachment.contentType.startsWith("image/")
      ? attachment.contentType
      : "image/png";
    const dataUrl = `data:${mime};base64,${attachment.content.toString("base64")}`;
    return tag.replace(
      /\bsrc\s*=\s*(?:["']cid:[^"']+["']|cid:[^\s>]+)/i,
      `src="${dataUrl}"`,
    );
  });
}

/**
 * LibreOffice 7.4's HTML import treats @page / page-break / `page:` as
 * section breaks and emits a blank first page. Neutralise those only.
 */
function neutralizePagedCss(css: string): string {
  return css
    .replace(/@page[^{]*\{[\s\S]*?\}/gi, "")
    .replace(/page-break-[a-z]+\s*:\s*[^;}{]+;?/gi, "")
    .replace(/break-(?:before|after|inside)\s*:\s*[^;}{]+;?/gi, "")
    .replace(/(^|[;{\s])page\s*:\s*[^;}{]+;?/gi, "$1")
    .trim();
}

function collectCleanStyles(html: string): string {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => neutralizePagedCss(match[1] ?? ""))
    .filter(Boolean)
    .join("\n");
}

function extractHtmlBody(html: string): string {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (body?.[1] != null) return body[1];
  return html
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<\/?html\b[^>]*>/gi, "");
}

/**
 * Body HTML from the wild is not safe to hand to LibreOffice as-is.
 * Drop scripts and remote images (the converter would fetch them and
 * stall), take the body only so a leftover Windows-1252 charset meta
 * cannot re-decode our UTF-8 file, and strip page-break CSS.
 */
export function sanitizeEmailHtml(html: string): string {
  const styles = collectCleanStyles(html);
  let body = extractHtmlBody(html);
  body = body
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, "")
    .replace(/<xml\b[^>]*>[\s\S]*?<\/xml>/gi, "")
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /<img\b[^>]*\bsrc\s*=\s*("(?:https?:|\/\/)[^"]*"|'(?:https?:|\/\/)[^']*')[^>]*>/gi,
      "",
    )
    .replace(/<img\b[^>]*\bsrc\s*=\s*("cid:[^"]*"|'cid:[^']*')[^>]*>/gi, "");
  if (styles) return `<style>${styles}</style>${body}`;
  return body;
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

  // LibreOffice 7.4 inserts a blank first page when the HTML body starts
  // with a heading, a paragraph, or an <hr>. Keep the masthead as a table
  // and draw the divider with a border.
  const body = email.html
    ? sanitizeEmailHtml(inlineCidImages(email.html, email.attachments))
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
.email-masthead { border-bottom: 1px solid #999; margin: 0 0 12pt 0; padding: 0 0 8pt 0; }
table.headers { border-collapse: collapse; margin: 0; }
table.headers th { text-align: left; padding: 1pt 10pt 1pt 0; color: #555; font-weight: normal; vertical-align: top; white-space: nowrap; }
table.headers td { padding: 1pt 0; vertical-align: top; }
table.headers td.email-subject { font-size: 15pt; font-weight: bold; padding: 0 0 8pt 0; }
</style>
</head>
<body>
<div class="email-masthead">
<table class="headers">
<tr><td class="email-subject" colspan="2">${escapeHtml(email.subject || "(no subject)")}</td></tr>
${rows
  .filter(([, value]) => value)
  .map(
    ([label, value]) =>
      `<tr><th>${label}</th><td>${escapeHtml(value)}</td></tr>`,
  )
  .join("\n")}
</table>
</div>
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
