/**
 * Email header helpers used when a filed .eml/.msg should join a live Outlook
 * thread. Full body rendering lives elsewhere; this module only extracts the
 * Message-ID join key.
 */

const MESSAGE_ID_HEADER =
  /(?:^|\n)message-id:\s*(?:[ \t]*\r?\n[ \t]+)*([^\r\n]+)/i;

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

export function normalizeInternetMessageId(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const angled = trimmed.startsWith("<") ? trimmed : `<${trimmed}>`;
  return angled.length <= 998 ? angled : null;
}

export function normalizeMailboxSubject(subject: string | null | undefined) {
  if (!subject) return "";
  return subject
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
