// Background pass that writes the email-only "where the matter sits" block
// into project memory. Live chat never runs this. Chat transcripts never
// enter the block. A newer email, a Zoho pull, or the existing-matter sweep
// schedules it; the curator is fenced from wiping the result.

import { completeText, DEFAULT_TITLE_MODEL, type UserApiKeys } from "../../lib/llm";
import { enqueueDbJob } from "../../lib/dbq/enqueue";
import type { Db, DbJob } from "../../lib/dbq/types";
import { isEmailDocumentType } from "../../lib/documentTypes";
import { attachActiveVersionPaths } from "../../lib/documentVersions";
import {
  emailToText,
  parseEmail,
  type ParsedEmail,
} from "../../lib/emailMessage";
import { logError } from "../../lib/log";
import {
  ensureMemoryFile,
  MemoryDisabledError,
  MemoryRevisionConflictError,
  writeMemoryFile,
} from "../../lib/memory/files";
import {
  buildMatterStatusMarkdown,
  documentSortDate,
  extractMatterStatusMeta,
  extractMatterStatusSection,
  groupDocumentsForIndex,
  MATTER_STATUS_START,
  mergeMatterStatusIntoMemory,
  namedWorkingFiles,
  recentDrafts,
  selectLatestEmailThread,
  type MatterDocument,
} from "../../lib/memory/matterStatus";
import { downloadFile } from "../../lib/storage";
import { getUserModelSettings } from "../user/user.service";

export const MATTER_BRIEF_JOB_KIND = "memory.matter_brief";
export const MATTER_BRIEF_DEBOUNCE_MS = 120_000;
const THREAD_PARSE_LIMIT = 20;
const THREAD_MESSAGE_LIMIT = 12;
const THREAD_TEXT_LIMIT = 24_000;
const STATUS_CHAR_LIMIT = 2_400;
const PROJECT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MatterBriefServices = {
  completeText: typeof completeText;
  downloadFile: typeof downloadFile;
  parseEmail: typeof parseEmail;
  writeMemoryFile: typeof writeMemoryFile;
  getUserModelSettings: typeof getUserModelSettings;
};

const defaultServices: MatterBriefServices = {
  completeText,
  downloadFile,
  parseEmail,
  writeMemoryFile,
  getUserModelSettings,
};

export async function enqueueProjectMatterBrief(
  db: Db,
  projectId: string | null | undefined,
  options: { delayMs?: number } = {},
): Promise<void> {
  if (!projectId || !PROJECT_ID_RE.test(projectId)) return;
  const delayMs = options.delayMs ?? MATTER_BRIEF_DEBOUNCE_MS;
  try {
    await enqueueDbJob(db, {
      kind: MATTER_BRIEF_JOB_KIND,
      payload: { projectId },
      dedupeKey: `${MATTER_BRIEF_JOB_KIND}:${projectId}`,
      runAt: new Date(Date.now() + delayMs).toISOString(),
      maxAttempts: 5,
    });
  } catch (error) {
    logError("matter-brief", error, { projectId, stage: "enqueue" });
  }
}

export async function enqueueMatterBriefForDocument(
  db: Db,
  documentId: string | null | undefined,
): Promise<void> {
  if (!documentId) return;
  try {
    const { data } = await db
      .from("documents")
      .select("project_id")
      .eq("id", documentId)
      .maybeSingle();
    const projectId =
      typeof data?.project_id === "string" ? data.project_id : null;
    await enqueueProjectMatterBrief(db, projectId);
  } catch (error) {
    logError("matter-brief", error, { documentId, stage: "enqueue-document" });
  }
}

/** Rebuild existing Colleague matters that already have correspondence. */
export async function enqueueMatterBriefsForExistingProjects(
  db: Db,
): Promise<number> {
  const projectIds = await projectIdsNeedingMatterBrief(db);
  for (const [index, projectId] of projectIds.entries()) {
    const delayMs = MATTER_BRIEF_DEBOUNCE_MS + (index % 30) * 60_000;
    await enqueueProjectMatterBrief(db, projectId, { delayMs });
  }
  return projectIds.length;
}

export async function handleMemoryMatterBrief(
  db: Db,
  job: DbJob,
  services: MatterBriefServices = defaultServices,
): Promise<Record<string, unknown>> {
  const projectId =
    typeof job.payload.projectId === "string" ? job.payload.projectId : "";
  if (!PROJECT_ID_RE.test(projectId)) {
    return { skipped: "malformed_payload" };
  }
  return runProjectMatterBrief(db, projectId, job.id, services);
}

export async function runProjectMatterBrief(
  db: Db,
  projectId: string,
  jobId?: string,
  services: MatterBriefServices = defaultServices,
): Promise<Record<string, unknown>> {
  const { data: project, error: projectError } = await db
    .from("projects")
    .select("id, user_id, name, client_name, cm_number")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) throw new Error("Matter brief could not load the project");
  if (!project) return { skipped: "project_missing" };

  const documents = await loadProjectDocuments(db, projectId);
  const emails = documents.filter((doc) => isEmailDocumentType(doc.fileType));
  const parsed = await parseRecentEmails(emails, services);
  const thread = selectLatestEmailThread(emails, parsed.subjects);
  const threadDocs = (thread?.documents ?? []).slice(-THREAD_MESSAGE_LIMIT);
  const threadText = threadDocs
    .map((doc) => parsed.texts.get(doc.id))
    .filter((text): text is string => !!text)
    .join("\n\n---\n\n");
  const attachments = threadDocs.flatMap(
    (doc) => parsed.attachments.get(doc.id) ?? [],
  );
  const fromThread = namedWorkingFiles(documents, threadText, attachments);
  const workingFiles = fromThread.length > 0 ? fromThread : recentDrafts(documents);
  const index = groupDocumentsForIndex(documents);

  let file;
  try {
    file = await ensureMemoryFile(db, "project", projectId);
  } catch (error) {
    logError("matter-brief", error, { projectId, stage: "ensure" });
    throw new Error("Matter brief could not load project memory");
  }
  if (!file.enabled) return { skipped: "memory_disabled" };

  const existingMeta = extractMatterStatusMeta(file.content ?? "");
  const sameThread =
    !!thread && existingMeta.thread === thread.fingerprint && !!existingMeta.thread;
  const statusParagraphs = sameThread
    ? existingStatusParagraphs(file.content ?? "")
    : await draftStatusParagraphs({
        db,
        projectName:
          [project.cm_number, project.client_name, project.name]
            .filter((value) => typeof value === "string" && value.trim())
            .join(" - ") || "this matter",
        threadText: threadText.slice(0, THREAD_TEXT_LIMIT),
        hasThread: !!thread,
        ownerUserId:
          typeof project.user_id === "string" ? project.user_id : null,
        services,
      });

  const section = buildMatterStatusMarkdown({
    statusParagraphs,
    workingFiles,
    workingFilesFromThread: fromThread.length > 0,
    index,
    thread: thread
      ? { ...thread, documents: threadDocs }
      : null,
    generatedAt: new Date(),
  });
  const content = mergeMatterStatusIntoMemory(file.content ?? "", section);

  try {
    const written = await writeBrief(services, {
      db,
      file,
      content,
      updatedBy: typeof project.user_id === "string" ? project.user_id : null,
      jobId: jobId ?? null,
    });
    if (await newerEmailArrived(db, projectId, emails)) {
      await enqueueProjectMatterBrief(db, projectId, { delayMs: 30_000 });
      return { applied: written.applied, refreshed: true };
    }
    return { applied: written.applied, refreshed: false };
  } catch (error) {
    if (error instanceof MemoryDisabledError) {
      return { skipped: "memory_disabled" };
    }
    throw error;
  }
}

async function writeBrief(
  services: MatterBriefServices,
  args: {
    db: Db;
    file: Awaited<ReturnType<typeof ensureMemoryFile>>;
    content: string;
    updatedBy: string | null;
    jobId: string | null;
  },
) {
  try {
    return await services.writeMemoryFile({
      db: args.db,
      file: args.file,
      content: args.content,
      expectedRevision: Number(args.file.revision),
      source: "manual",
      updatedBy: args.updatedBy,
      sourceJobId: args.jobId,
    });
  } catch (error) {
    if (!(error instanceof MemoryRevisionConflictError)) throw error;
    const fresh = await ensureMemoryFile(args.db, "project", args.file.project_id as string);
    return services.writeMemoryFile({
      db: args.db,
      file: fresh,
      content: mergeMatterStatusIntoMemory(
        fresh.content ?? "",
        extractMatterStatusSection(args.content) ?? args.content,
      ),
      expectedRevision: Number(fresh.revision),
      source: "manual",
      updatedBy: args.updatedBy,
      sourceJobId: args.jobId,
    });
  }
}

async function draftStatusParagraphs(args: {
  db: Db;
  projectName: string;
  threadText: string;
  hasThread: boolean;
  ownerUserId: string | null;
  services: MatterBriefServices;
}): Promise<string> {
  if (!args.hasThread || !args.threadText.trim()) {
    return "No correspondence is on the file yet.";
  }
  let apiKeys: UserApiKeys | undefined;
  let model = process.env.MEMORY_MATTER_BRIEF_MODEL?.trim()
    || process.env.MEMORY_CURATOR_MODEL?.trim()
    || DEFAULT_TITLE_MODEL;
  if (args.ownerUserId) {
    try {
      const settings = await args.services.getUserModelSettings(
        args.ownerUserId,
        args.db,
      );
      apiKeys = settings.api_keys;
      model =
        process.env.MEMORY_MATTER_BRIEF_MODEL?.trim()
        || process.env.MEMORY_CURATOR_MODEL?.trim()
        || settings.memory_curator_model
        || settings.last_selected_chat_model
        || DEFAULT_TITLE_MODEL;
    } catch (error) {
      logError("matter-brief", error, { stage: "model-settings" });
    }
  }
  try {
    const drafted = await args.services.completeText({
      model,
      apiKeys,
      maxTokens: 700,
      systemPrompt: [
        "You write a short file note for a law-matter memory file.",
        "Use only the emails below. Do not invent facts. Do not quote long passages.",
        "Australian English. Do not use em dashes. Do not mention that you are an AI or that you read a database.",
        "Write two to five short paragraphs. Start with a line in this form:",
        "As at <date> (latest email thread: <subject>).",
        "Then say who last wrote, what they asked or agreed, and what is still open.",
        "Name working files only when the emails name them. This is a file note, not instrument text.",
      ].join(" "),
      user: `Matter: ${args.projectName}\n\nLatest email thread:\n\n${args.threadText}`,
    });
    const cleaned = drafted.replace(/\u2014/g, ", ").trim();
    if (!cleaned) {
      return "The latest email thread is on the file. Open it for the current position.";
    }
    return cleaned.length > STATUS_CHAR_LIMIT
      ? cleaned.slice(0, STATUS_CHAR_LIMIT).trimEnd()
      : cleaned;
  } catch (error) {
    logError("matter-brief", error, { stage: "draft-status" });
    return "The latest email thread is on the file. Open it for the current position.";
  }
}

async function parseRecentEmails(
  emails: MatterDocument[],
  services: MatterBriefServices,
): Promise<{
  subjects: Map<string, { subject: string; date: Date | null }>;
  texts: Map<string, string>;
  attachments: Map<string, string[]>;
}> {
  const newest = [...emails]
    .sort(
      (left, right) =>
        documentSortDate(right).getTime() - documentSortDate(left).getTime(),
    )
    .slice(0, THREAD_PARSE_LIMIT);
  const subjects = new Map<string, { subject: string; date: Date | null }>();
  const texts = new Map<string, string>();
  const attachments = new Map<string, string[]>();
  for (const email of newest) {
    if (!email.storagePath) continue;
    try {
      const bytes = await services.downloadFile(email.storagePath);
      if (!bytes) continue;
      const parsed: ParsedEmail = await services.parseEmail(
        Buffer.from(bytes),
        email.fileType,
      );
      subjects.set(email.id, {
        subject: parsed.subject,
        date: parsed.date,
      });
      texts.set(email.id, emailToText(parsed));
      attachments.set(
        email.id,
        parsed.attachments
          .filter((attachment) => !attachment.inline)
          .map((attachment) => attachment.filename),
      );
    } catch (error) {
      logError("matter-brief", error, {
        documentId: email.id,
        stage: "parse-email",
      });
    }
  }
  return { subjects, texts, attachments };
}

async function loadProjectDocuments(
  db: Db,
  projectId: string,
): Promise<MatterDocument[]> {
  const [{ data: docs }, { data: folders }] = await Promise.all([
    db
      .from("documents")
      .select("id, current_version_id, status, folder_id, created_at")
      .eq("project_id", projectId)
      .eq("status", "ready")
      .order("created_at", { ascending: true }),
    db
      .from("project_subfolders")
      .select("id, name, parent_folder_id")
      .eq("project_id", projectId),
  ]);
  const docList = (docs ?? []) as {
    id: string;
    current_version_id?: string | null;
    folder_id?: string | null;
    created_at?: string | null;
    filename?: string | null;
    file_type?: string | null;
    storage_path?: string | null;
  }[];
  await attachActiveVersionPaths(db, docList);

  const folderMap = new Map<
    string,
    { name: string; parent_folder_id: string | null }
  >();
  for (const folder of folders ?? []) {
    folderMap.set(folder.id, {
      name: folder.name,
      parent_folder_id: folder.parent_folder_id,
    });
  }

  const resolvePath = (folderId: string | null | undefined): string => {
    if (!folderId) return "";
    const parts: string[] = [];
    let current: string | null = folderId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const folder = folderMap.get(current);
      if (!folder) break;
      parts.unshift(folder.name);
      current = folder.parent_folder_id;
    }
    return parts.join(" / ");
  };

  return docList
    .filter((doc) => !!doc.storage_path)
    .map((doc) => ({
      id: doc.id,
      filename: doc.filename?.trim() || "Untitled document",
      fileType: (doc.file_type ?? "").toLowerCase(),
      createdAt: doc.created_at ?? "",
      folderPath: resolvePath(doc.folder_id),
      storagePath: doc.storage_path ?? null,
    }));
}

async function newerEmailArrived(
  db: Db,
  projectId: string,
  seen: MatterDocument[],
): Promise<boolean> {
  const seenIds = new Set(seen.map((doc) => doc.id));
  const latest = await loadProjectDocuments(db, projectId);
  return latest.some(
    (doc) => isEmailDocumentType(doc.fileType) && !seenIds.has(doc.id),
  );
}

async function projectIdsWithReadyEmails(db: Db): Promise<string[]> {
  const versionIds: string[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("document_versions")
      .select("id")
      .in("file_type", ["eml", "msg"])
      .is("deleted_at", null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error("Matter brief sweep could not list emails");
    const rows = data ?? [];
    for (const row of rows) {
      if (typeof row.id === "string") versionIds.push(row.id);
    }
    if (rows.length < pageSize) break;
  }
  if (versionIds.length === 0) return [];

  const projectIds = new Set<string>();
  for (let index = 0; index < versionIds.length; index += pageSize) {
    const chunk = versionIds.slice(index, index + pageSize);
    const { data, error } = await db
      .from("documents")
      .select("project_id, current_version_id, status")
      .in("current_version_id", chunk)
      .eq("status", "ready")
      .not("project_id", "is", null);
    if (error) throw new Error("Matter brief sweep could not list projects");
    for (const row of data ?? []) {
      if (typeof row.project_id === "string") projectIds.add(row.project_id);
    }
  }
  return [...projectIds];
}

async function projectIdsNeedingMatterBrief(db: Db): Promise<string[]> {
  const projectIds = await projectIdsWithReadyEmails(db);
  if (projectIds.length === 0) return [];
  const withSection = new Set<string>();
  const pageSize = 200;
  for (let index = 0; index < projectIds.length; index += pageSize) {
    const chunk = projectIds.slice(index, index + pageSize);
    const { data, error } = await db
      .from("memory_files")
      .select("project_id, content, enabled")
      .eq("scope", "project")
      .in("project_id", chunk);
    if (error) throw new Error("Matter brief sweep could not load memory");
    for (const row of data ?? []) {
      if (typeof row.project_id !== "string") continue;
      if (row.enabled === false) {
        withSection.add(row.project_id);
        continue;
      }
      if (
        typeof row.content === "string"
        && row.content.includes(MATTER_STATUS_START)
      ) {
        withSection.add(row.project_id);
      }
    }
  }
  return projectIds.filter((projectId) => !withSection.has(projectId));
}

function existingStatusParagraphs(content: string): string {
  const start = content.indexOf("# Where the matter sits");
  const working = content.search(/^## (?:Current working files|Recent drafts)/m);
  const end = content.indexOf("<!-- matter-status:end -->");
  if (start === -1) return "";
  const from = content.indexOf("\n", start);
  const to = working === -1 ? end : working;
  if (from === -1 || to === -1 || to <= from) return "";
  return content.slice(from, to).trim();
}
