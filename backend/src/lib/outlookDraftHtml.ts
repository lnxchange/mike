export const OUTLOOK_SIGNATURE_SENTINEL =
  '<span data-mike-sig="1" style="display:none"></span>';

const SIGN_OFF =
  /(?:kind\s+regards|best\s+regards|best\s+wishes|thanks|thank\s+you|cheers)\s*,?/gi;

const QUOTED_THREAD =
  /divRplyFwdMsg|OutlookMessageHeader|gmail_quote|mail-editor-reference-message-container|<blockquote\b|From:(?:[^<]{0,40}<[^>]+>){1,8}[^<]{0,80}?Sent:/i;

const SIGNATURE_ID = /^(?:x_)?(?:signature|ms-outlook-mobile-signature)$/i;

/** Outlook's conversation diff (`uniqueBody`) drops a repeated signature, and the full body then continues into the quoted thread. Keep only the part the sender wrote. */
function ownMessageHtml(html: string): string {
  const start = quoteStartIndex(html);
  if (start == null || start === 0) return html;
  return html.slice(0, start);
}

function quoteStartIndex(html: string): number | null {
  const patterns = [
    /<div\b[^>]*(?:\bid|\bclass)=["'][^"']*(?:divRplyFwdMsg|OutlookMessageHeader|gmail_quote|mail-editor-reference-message-container)[^"']*["'][^>]*>/i,
    /<blockquote\b/i,
    /<hr\b[^>]*\btabindex=["']-1["']/i,
    /From:(?:[^<]{0,40}<[^>]+>){1,8}[^<]{0,80}?Sent:/i,
  ];
  let earliest: number | null = null;
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (!match || match.index === undefined) continue;
    if (earliest == null || match.index < earliest) earliest = match.index;
  }
  return earliest;
}

export function outlookInnerHtmlFromDraftBody(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "<p></p>";
  if (looksLikeHtml(trimmed)) {
    return promoteParagraphLists(
      applyInlineMarkdownInHtml(sanitizeDraftHtml(trimmed)),
    );
  }
  return markdownToInnerHtml(trimmed);
}

export function wrapOutlookHtmlDocument(inner: string): string {
  const body = extractExistingBody(inner) ?? inner;
  return `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1F1F1F">${body}</body></html>`;
}

export function bodyAlreadyHasSignature(html: string): boolean {
  return /data-mike-sig=|data-attune-sig=|id=["'](?:x_)?Signature["']/i.test(
    html,
  );
}

export function appendOutlookSignature(inner: string, signatureHtml: string): string {
  if (!signatureHtml.trim() || bodyAlreadyHasSignature(inner)) return inner;
  return `${inner}${OUTLOOK_SIGNATURE_SENTINEL}${signatureHtml}`;
}

export function extractOutlookSignatureHtml(html: string): string | null {
  const own = ownMessageHtml(html);
  const marked = extractMarkedSignature(own);
  if (marked) return marked;
  const afterSend = htmlAfterAppendOnSend(own);
  if (afterSend) {
    const fromMarker = extractMarkedSignature(afterSend) ?? afterSend;
    if (isPlausibleSignature(fromMarker, false)) return fromMarker;
  }
  const afterSignOff = htmlAfterLastSignOff(own);
  if (afterSignOff && isPlausibleSignature(afterSignOff, false)) return afterSignOff;
  return null;
}

export function referencedContentIds(html: string): string[] {
  const ids = new Set<string>();
  const pattern = /(?:src|cid)=["']?(?:cid:)?([^"'>\s]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const raw = (match[1] ?? "").replace(/^<|>$/g, "").trim();
    if (raw) ids.add(raw);
  }
  return [...ids];
}

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function extractExistingBody(html: string): string | null {
  const match = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return match ? (match[1] ?? "").trim() : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/__(.+?)__/g, "<b>$1</b>")
    .replace(/(?<![\w/])\*(?!\s)(.+?)(?<!\s)\*(?![\w/])/g, "<i>$1</i>");
}

function markdownToInnerHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      html.push("<ul>");
      while (index < lines.length) {
        const item = /^[-*]\s+(.+)/.exec(lines[index] ?? "");
        if (!item) break;
        html.push(`<li>${renderInline(item[1] ?? "")}</li>`);
        index += 1;
      }
      html.push("</ul>");
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      html.push("<ol>");
      while (index < lines.length) {
        const item = /^\d+\.\s+(.+)/.exec(lines[index] ?? "");
        if (!item) break;
        html.push(`<li>${renderInline(item[1] ?? "")}</li>`);
        index += 1;
      }
      html.push("</ol>");
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? "").trim() &&
      !/^([-*]|\d+\.)\s+/.test(lines[index] ?? "")
    ) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }
  return html.join("") || "<p></p>";
}

function sanitizeDraftHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(?:script|style|iframe|object|embed)\b[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/href\s*=\s*(['"])\s*javascript:[\s\S]*?\1/gi, 'href="#"')
    .replace(/<\s*strong\b/gi, "<b")
    .replace(/<\s*\/\s*strong\s*>/gi, "</b>")
    .replace(/<\s*em\b/gi, "<i")
    .replace(/<\s*\/\s*em\s*>/gi, "</i>");
}

function applyInlineMarkdownInHtml(html: string): string {
  return html.replace(/>([^<]+)</g, (_full, text: string) => {
    const next = text
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/__(.+?)__/g, "<b>$1</b>");
    return `>${next}<`;
  });
}

function promoteParagraphLists(html: string): string {
  return html.replace(/(?:<p>\s*[-*]\s+[\s\S]*?<\/p>\s*){2,}/gi, (block) => {
    const items = [...block.matchAll(/<p>\s*[-*]\s+([\s\S]*?)<\/p>/gi)];
    if (items.length < 2) return block;
    return `<ul>${items.map((item) => `<li>${item[1]}</li>`).join("")}</ul>`;
  });
}

function tagAttribute(tag: string, name: string): string {
  return (
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1] ?? ""
  );
}

function isSignatureTag(tag: string): boolean {
  if (SIGNATURE_ID.test(tagAttribute(tag, "id"))) return true;
  return /(?:^|\s)(?:x_)?signature(?:\s|$)/i.test(tagAttribute(tag, "class"));
}

function sliceBalancedElement(
  html: string,
  index: number,
  tagName: string,
): string | null {
  const token = new RegExp(`<(/?)${tagName}\\b[^>]*>`, "gi");
  token.lastIndex = index;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(html))) {
    if (match[1]) depth -= 1;
    else depth += 1;
    if (depth === 0) return html.slice(index, match.index + match[0].length);
  }
  return null;
}

function extractMarkedSignature(html: string): string | null {
  const tagRe = /<(div|table|section)\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    const tag = match[0];
    if (!match[1] || !isSignatureTag(tag) || match.index === undefined) continue;
    const element = sliceBalancedElement(html, match.index, match[1]);
    if (!element) continue;
    const trimmed = withoutQuotedTail(element);
    if (isPlausibleSignature(trimmed, true)) return trimmed;
  }
  return null;
}

function withoutQuotedTail(html: string): string {
  const start = quoteStartIndex(html);
  if (start == null || start === 0) return html;
  return html.slice(0, start);
}

function htmlAfterAppendOnSend(html: string): string | null {
  const marker =
    /<div\b[^>]*\bid=["']appendonsend["'][^>]*>\s*<\/div>/i.exec(html);
  if (!marker || marker.index === undefined) return null;
  const rest = html.slice(marker.index + marker[0].length).trim();
  return rest || null;
}

function htmlAfterLastSignOff(html: string): string | null {
  let last: RegExpExecArray | null = null;
  const pattern = new RegExp(SIGN_OFF.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) last = match;
  if (!last) return null;
  const rest = html.slice(last.index + last[0].length).trim();
  return rest || null;
}

export const MAX_STORED_SIGNATURE_CHARS = 500_000;
export const MAX_SIGNATURE_IMAGE_BYTES = 500_000;
export const MAX_SIGNATURE_IMAGES = 8;

const SIGNATURE_IMAGE_MIME = /^image\/(?:png|jpeg|gif|webp)$/;

export type StoredSignatureImage = {
  filename: string;
  contentType: string;
  bytes: Buffer;
  isInline: true;
  contentId: string;
};

/** Fold cid images into the HTML so the account can keep one signature field. */
export function embedSignatureImages(
  html: string,
  images: Array<{ contentId?: string; contentType: string; bytes: Buffer }>,
): string {
  return html.replace(
    /\bsrc\s*=\s*(["'])cid:([^"']+)\1/gi,
    (full, quote: string, rawId: string) => {
      const image = images.find((item) => {
        const mime = signatureImageMime(item.contentType);
        const contentId = item.contentId?.trim();
        if (!mime || !contentId || item.bytes.length === 0) return false;
        if (item.bytes.length > MAX_SIGNATURE_IMAGE_BYTES) return false;
        return (
          rawId === contentId ||
          rawId.startsWith(`${contentId}@`) ||
          contentId.startsWith(`${rawId}@`)
        );
      });
      if (!image) return full;
      const mime = signatureImageMime(image.contentType);
      if (!mime) return full;
      return `src=${quote}data:${mime};base64,${image.bytes.toString("base64")}${quote}`;
    },
  );
}

/** Turn stored data-URI images back into Outlook inline attachments. */
export function materializeStoredSignature(html: string): {
  html: string;
  images: StoredSignatureImage[];
  rejected: boolean;
} {
  const images: StoredSignatureImage[] = [];
  let rejected = false;
  let index = 0;
  const rewritten = html.replace(
    /\bsrc\s*=\s*(["'])data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)\1/gi,
    (_match, _quote: string, mime: string, payload: string) => {
      const bytes = Buffer.from(payload.replace(/\s+/g, ""), "base64");
      if (
        bytes.length === 0 ||
        bytes.length > MAX_SIGNATURE_IMAGE_BYTES ||
        images.length >= MAX_SIGNATURE_IMAGES
      ) {
        rejected = true;
        return 'src=""';
      }
      index += 1;
      const contentType = mime.toLowerCase();
      const extension = contentType === "image/jpeg" ? "jpg" : contentType.slice("image/".length);
      const contentId = `mike-signature-${index}`;
      images.push({
        filename: `signature-${index}.${extension}`,
        contentType,
        bytes,
        isInline: true,
        contentId,
      });
      return `src="cid:${contentId}"`;
    },
  );
  return { html: rewritten, images, rejected };
}

/** Drop active content before a signature is stored or shown. */
export function sanitizeStoredSignatureHtml(input: string): string {
  let html = input.replace(/\0/g, "");
  html = html.replace(
    /<(script|iframe|object|embed|form|link|meta|base|style)\b[^>]*>[\s\S]*?<\/\1>/gi,
    "",
  );
  html = html.replace(
    /<(script|iframe|object|embed|form|link|meta|base|style)\b[^>]*\/?>/gi,
    "",
  );
  html = html.replace(
    /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    "",
  );
  html = html.replace(
    /\s(?:href|src)\s*=\s*(["'])\s*(?:javascript|vbscript):[^"']*\1/gi,
    "",
  );
  html = html.replace(
    /\ssrc=(["'])data:(?!image\/(?:png|jpeg|gif|webp);base64,)[^"']*\1/gi,
    "",
  );
  return html.trim();
}

function signatureImageMime(contentType: string): string | null {
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const normalised = mime === "image/jpg" ? "image/jpeg" : mime;
  return SIGNATURE_IMAGE_MIME.test(normalised) ? normalised : null;
}

function isPlausibleSignature(html: string, marked: boolean): boolean {
  const maxHtml = marked ? 80000 : 20000;
  const minHtml = marked ? 8 : 20;
  if (html.length < minHtml || html.length > maxHtml) return false;
  if (QUOTED_THREAD.test(html)) return false;
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const hasImage = /<img\b/i.test(html);
  if (marked && hasImage && text.length < 12) return true;
  if (text.length < (marked ? 4 : 12) || text.length > (marked ? 6000 : 2500)) {
    return false;
  }
  if (/^(hi|hello|dear)\s+\S+/i.test(text)) return false;
  return true;
}
