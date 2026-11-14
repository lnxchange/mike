// Compact, email-derived matter status for project memory.md.
//
// The live chat used to treat AVAILABLE DOCUMENTS as a reading list. This
// module builds the three sections that replace that first-time crawl:
//
//   1. Where the matter sits, from the latest email thread only
//   2. Current working files named in that thread
//   3. A grouped index (counts and latest file, not every name)
//
// Chat transcripts never belong in this block. The curator must copy the
// fenced section verbatim; merge helpers also restore it if a write drops it.

import { createHash } from "node:crypto";
import { isEmailDocumentType } from "../documentTypes";
import { MEMORY_MAX_BYTES } from "./files";

export const MATTER_STATUS_START = "<!-- matter-status:start -->";
export const MATTER_STATUS_END = "<!-- matter-status:end -->";

const SUBJECT_PREFIX = /^(?:(?:re|fw|fwd|aw|sv|antw|resp)\s*:\s*)+/i;
const FILENAME_DATE = /\b(\d{6})\b/g;
const REPLY_NOISE = /^(?:important correspondence from|automatic reply|out of office)\s+/i;

export type MatterDocument = {
  id: string;
  filename: string;
  fileType: string;
  createdAt: string;
  folderPath: string;
  storagePath: string | null;
};

export type MatterIndexGroup = {
  label: string;
  count: number;
  latestFilename: string;
  latestDate: Date | null;
};

export type LatestEmailThread = {
  subject: string;
  normalizedSubject: string;
  documents: MatterDocument[];
  fingerprint: string;
};

export function extractMatterStatusSection(content: string): string | null {
  const start = content.indexOf(MATTER_STATUS_START);
  const end = content.indexOf(MATTER_STATUS_END);
  if (start === -1 || end === -1 || end < start) return null;
  return content.slice(start, end + MATTER_STATUS_END.length);
}

export function stripMatterStatusSection(content: string): string {
  const start = content.indexOf(MATTER_STATUS_START);
  const end = content.indexOf(MATTER_STATUS_END);
  if (start === -1 || end === -1 || end < start) return content.trim();
  return `${content.slice(0, start).trim()}\n\n${content
    .slice(end + MATTER_STATUS_END.length)
    .trim()}`.trim();
}

/** Replace or prepend the sync-owned block; curator notes stay outside it. */
export function mergeMatterStatusIntoMemory(
  existing: string,
  section: string,
): string {
  const notes = stripMatterStatusSection(existing);
  const body = `${section.trim()}${notes ? `\n\n${notes}` : ""}\n`;
  return fitMemory(body);
}

/**
 * The curator owns notes outside the fence. If it edits or drops the
 * sync-owned block, put the previous block back at the top.
 */
export function preserveMatterStatusSection(
  previous: string,
  proposed: string,
): string {
  const previousSection = extractMatterStatusSection(previous);
  if (!previousSection) return proposed;
  if (extractMatterStatusSection(proposed) === previousSection) return proposed;
  return mergeMatterStatusIntoMemory(proposed, previousSection);
}

export function extractMatterStatusMeta(content: string): {
  thread: string | null;
  generated: string | null;
} {
  const section = extractMatterStatusSection(content) ?? content;
  const match = section.match(
    /<!--\s*matter-status-meta\s+thread="([^"]*)"\s+generated="([^"]*)"\s*-->/,
  );
  return {
    thread: match?.[1] ?? null,
    generated: match?.[2] ?? null,
  };
}

export function normalizeEmailSubject(subject: string): string {
  let value = subject.replace(/\s+/g, " ").trim();
  value = value.replace(REPLY_NOISE, "");
  while (SUBJECT_PREFIX.test(value)) {
    value = value.replace(SUBJECT_PREFIX, "").trim();
  }
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function parseFilenameTimestamp(filename: string): Date | null {
  let latest: Date | null = null;
  for (const match of filename.matchAll(FILENAME_DATE)) {
    const parsed = parseYymmdd(match[1] ?? "");
    if (parsed && (!latest || parsed > latest)) latest = parsed;
  }
  return latest;
}

export function documentSortDate(doc: MatterDocument): Date {
  return (
    parseFilenameTimestamp(doc.filename) ??
    parseIsoDate(doc.createdAt) ??
    new Date(0)
  );
}

export function threadFingerprint(
  documents: Array<Pick<MatterDocument, "id" | "createdAt" | "filename">>,
  normalizedSubject: string,
): string {
  const material = [
    normalizedSubject,
    ...[...documents]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((doc) => `${doc.id}:${doc.filename}:${doc.createdAt}`),
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex").slice(0, 16);
}

export function selectLatestEmailThread(
  emails: MatterDocument[],
  parsedSubjects: Map<string, { subject: string; date: Date | null }>,
): LatestEmailThread | null {
  if (emails.length === 0) return null;

  const groups = new Map<string, MatterDocument[]>();
  for (const email of emails) {
    const parsed = parsedSubjects.get(email.id);
    const key =
      normalizeEmailSubject(parsed?.subject || subjectFromFilename(email.filename)) ||
      email.id;
    const group = groups.get(key) ?? [];
    group.push(email);
    groups.set(key, group);
  }

  let latestKey = "";
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const [key, group] of groups) {
    const newest = group.reduce((best, email) => {
      const parsed = parsedSubjects.get(email.id);
      const at = (
        parsed?.date ?? documentSortDate(email)
      ).getTime();
      return at > best ? at : best;
    }, Number.NEGATIVE_INFINITY);
    if (newest > latestAt) {
      latestAt = newest;
      latestKey = key;
    }
  }

  const documents = (groups.get(latestKey) ?? []).sort(
    (left, right) =>
      documentSortDate(left).getTime() - documentSortDate(right).getTime(),
  );
  const newest = documents[documents.length - 1];
  const parsed = newest ? parsedSubjects.get(newest.id) : undefined;
  const subject =
    parsed?.subject?.trim() ||
    (newest ? subjectFromFilename(newest.filename) : "") ||
    "Untitled thread";
  return {
    subject,
    normalizedSubject: latestKey,
    documents,
    fingerprint: threadFingerprint(documents, latestKey),
  };
}

export function groupDocumentsForIndex(docs: MatterDocument[]): MatterIndexGroup[] {
  const groups = new Map<string, MatterDocument[]>();
  for (const doc of docs) {
    const label = indexGroupLabel(doc);
    const group = groups.get(label) ?? [];
    group.push(doc);
    groups.set(label, group);
  }
  return [...groups.entries()]
    .map(([label, group]) => {
      const latest = [...group].sort(
        (left, right) =>
          documentSortDate(right).getTime() - documentSortDate(left).getTime(),
      )[0];
      return {
        label,
        count: group.length,
        latestFilename: latest?.filename ?? "Untitled document",
        latestDate: latest ? documentSortDate(latest) : null,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function namedWorkingFiles(
  docs: MatterDocument[],
  threadText: string,
  attachmentNames: string[] = [],
): MatterDocument[] {
  const haystack = `${threadText}\n${attachmentNames.join("\n")}`.toLowerCase();
  const named = docs.filter((doc) => {
    if (isEmailDocumentType(doc.fileType)) return false;
    const filename = doc.filename.toLowerCase();
    if (haystack.includes(filename)) return true;
    const stem = filenameStem(doc.filename).toLowerCase();
    return stem.length >= 12 && haystack.includes(stem);
  });
  return uniqueDocuments(named).sort(
    (left, right) =>
      documentSortDate(right).getTime() - documentSortDate(left).getTime(),
  );
}

export function recentDrafts(docs: MatterDocument[], limit = 3): MatterDocument[] {
  return docs
    .filter((doc) => !isEmailDocumentType(doc.fileType))
    .sort(
      (left, right) =>
        documentSortDate(right).getTime() - documentSortDate(left).getTime(),
    )
    .slice(0, limit);
}

export function formatAuDate(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Australia/Sydney",
  });
}

export function buildMatterStatusMarkdown(args: {
  statusParagraphs: string;
  workingFiles: MatterDocument[];
  workingFilesFromThread: boolean;
  index: MatterIndexGroup[];
  thread: LatestEmailThread | null;
  generatedAt: Date;
}): string {
  const asAt =
    args.thread && args.thread.documents.length > 0
      ? formatAuDate(
          documentSortDate(args.thread.documents[args.thread.documents.length - 1]!),
        )
      : formatAuDate(args.generatedAt);
  const threadLabel = args.thread?.subject
    ? ` (latest email thread: ${args.thread.subject.replace(/\s+/g, " ").trim()})`
    : "";
  const workingHeading = args.workingFilesFromThread
    ? "## Current working files"
    : "## Recent drafts";
  const workingLines =
    args.workingFiles.length > 0
      ? args.workingFiles.map((file) => `- ${file.filename}`)
      : ["- None named on the latest thread."];
  const indexLines =
    args.index.length > 0
      ? args.index.map((group) => {
          const latest = formatAuDate(group.latestDate);
          const latestBit = latest
            ? `, latest ${latest}: ${group.latestFilename}`
            : `: ${group.latestFilename}`;
          return `- ${group.label} (${group.count})${latestBit}`;
        })
      : ["- No ready documents on the file yet."];
  const paragraphs = args.statusParagraphs.trim() ||
    (args.thread
      ? `As at ${asAt}${threadLabel}. Open that thread for the current position.`
      : "No correspondence is on the file yet.");

  return [
    MATTER_STATUS_START,
    `<!-- matter-status-meta thread="${args.thread?.fingerprint ?? "none"}" generated="${args.generatedAt.toISOString()}" -->`,
    "# Where the matter sits",
    "",
    paragraphs,
    "",
    workingHeading,
    ...workingLines,
    "",
    "## Matter index",
    ...indexLines,
    MATTER_STATUS_END,
  ].join("\n");
}

function fitMemory(content: string): string {
  if (Buffer.byteLength(content, "utf8") <= MEMORY_MAX_BYTES) return content;
  const section = extractMatterStatusSection(content);
  if (!section) {
    return truncateUtf8(content, MEMORY_MAX_BYTES);
  }
  const notes = stripMatterStatusSection(content);
  const prefix = notes ? `${section}\n\n` : `${section}\n`;
  const budget = MEMORY_MAX_BYTES - Buffer.byteLength(prefix, "utf8");
  if (budget <= 0) return truncateUtf8(section, MEMORY_MAX_BYTES);
  if (!notes) return prefix;
  return `${prefix}${truncateUtf8(notes, budget)}`;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let cut = value.length;
  while (cut > 0 && Buffer.byteLength(value.slice(0, cut), "utf8") > maxBytes) {
    cut -= 1;
  }
  return value.slice(0, Math.max(0, cut)).trimEnd();
}

function parseYymmdd(value: string): Date | null {
  if (!/^\d{6}$/.test(value)) return null;
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function parseIsoDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function subjectFromFilename(filename: string): string {
  return filename
    .replace(/\.(?:eml|msg)$/i, "")
    .replace(/^\d{6}\s*-\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function filenameStem(filename: string): string {
  return filename
    .replace(/^\d{6}\s*-\s*/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function indexGroupLabel(doc: MatterDocument): string {
  if (doc.folderPath) return doc.folderPath;
  if (isEmailDocumentType(doc.fileType)) return "Correspondence";
  const name = doc.filename.toLowerCase();
  if (/\b(msa|master services?)\b/.test(name)) return "MSA drafts";
  if (/\b(sow|statement of work)\b/.test(name)) return "SOW drafts";
  if (/\.(xlsx|xlsm|xls)$/i.test(doc.filename)) return "Spreadsheets";
  if (/\.(pptx|ppt)$/i.test(doc.filename)) return "Presentations";
  if (/\.(docx|doc)$/i.test(doc.filename)) return "Word drafts";
  return "Other documents";
}

function uniqueDocuments(docs: MatterDocument[]): MatterDocument[] {
  const seen = new Set<string>();
  const out: MatterDocument[] = [];
  for (const doc of docs) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    out.push(doc);
  }
  return out;
}
