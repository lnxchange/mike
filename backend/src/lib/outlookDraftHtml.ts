export const OUTLOOK_SIGNATURE_SENTINEL =
  '<span data-mike-sig="1" style="display:none"></span>';

const SIGN_OFF =
  /(?:kind\s+regards|best\s+regards|best\s+wishes|thanks|thank\s+you|cheers)\s*,?/gi;

const QUOTED_THREAD =
  /divRplyFwdMsg|OutlookMessageHeader|gmail_quote|From:\s*[^<]*Sent:/i;

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
  const fromDiv = extractSignatureDiv(html);
  if (fromDiv && isPlausibleSignature(fromDiv)) return fromDiv;
  const afterSignOff = htmlAfterLastSignOff(html);
  if (afterSignOff && isPlausibleSignature(afterSignOff)) return afterSignOff;
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

function extractSignatureDiv(html: string): string | null {
  const open = /<div\b[^>]*\b(?:id|class)=["'](?:x_)?Signature["'][^>]*>/i.exec(
    html,
  );
  if (!open || open.index === undefined) return null;
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = open.index + open[0].length;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    if (match[0].startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) {
      return html.slice(open.index, match.index + match[0].length);
    }
  }
  return null;
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

function isPlausibleSignature(html: string): boolean {
  if (html.length < 20 || html.length > 20000) return false;
  if (QUOTED_THREAD.test(html)) return false;
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 12 || text.length > 2500) return false;
  if (/^(hi|hello|dear)\s+\S+/i.test(text)) return false;
  return true;
}
