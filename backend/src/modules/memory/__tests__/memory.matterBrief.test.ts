import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbJob } from "../../../lib/dbq/types";
import { MemoryRevisionConflictError } from "../../../lib/memory/files";
import { MATTER_STATUS_END, MATTER_STATUS_START } from "../../../lib/memory/matterStatus";

const enqueueDbJob = vi.fn();
vi.mock("../../../lib/dbq/enqueue", () => ({
  enqueueDbJob: (...args: unknown[]) => enqueueDbJob(...args),
}));

const ensureMemoryFile = vi.fn();
const writeMemoryFile = vi.fn();
vi.mock("../../../lib/memory/files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/memory/files")>();
  return {
    ...actual,
    ensureMemoryFile: (...args: unknown[]) => ensureMemoryFile(...args),
    writeMemoryFile: (...args: unknown[]) => writeMemoryFile(...args),
  };
});

import {
  enqueueProjectMatterBrief,
  handleMemoryMatterBrief,
  MATTER_BRIEF_JOB_KIND,
  type MatterBriefServices,
} from "../memory.matterBrief";

const PROJECT_ID = "e360041c-fe06-4743-8f43-23cae53a0f5b";

function job(payload: Record<string, unknown>): DbJob {
  return {
    id: "job-1",
    kind: MATTER_BRIEF_JOB_KIND,
    payload,
    status: "running",
    attempts: 1,
    max_attempts: 5,
    run_at: new Date().toISOString(),
    claimed_at: null,
    finished_at: null,
    last_error: null,
    dedupe_key: `${MATTER_BRIEF_JOB_KIND}:${PROJECT_ID}`,
    result: null,
    created_at: new Date().toISOString(),
  };
}

function memoryFile(content = "") {
  return {
    id: "mem-1",
    scope: "project" as const,
    user_id: null,
    project_id: PROJECT_ID,
    enabled: true,
    epoch: 1,
    revision: 3,
    learning_cutoff_at: "2026-01-01T00:00:00.000Z",
    content,
    content_sha256: null,
    size_bytes: 0,
    last_source_job_id: null,
    status: "idle" as const,
    last_error_code: null,
    last_source: null,
    updated_by: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function tableDb(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])] as Record<string, unknown>[];
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        in(column: string, values: unknown[]) {
          filters.push((row) => values.includes(row[column]));
          return builder;
        },
        is(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        not(column: string, operator: string, value: unknown) {
          if (operator === "is" && value === null) {
            filters.push((row) => row[column] != null);
          }
          return builder;
        },
        order() {
          return builder;
        },
        range(from: number, to: number) {
          rows = apply().slice(from, to + 1);
          return builder;
        },
        maybeSingle() {
          const data = apply()[0] ?? null;
          return Promise.resolve({ data, error: null });
        },
        then(
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve({ data: apply(), error: null }).then(
            resolve,
            reject,
          );
        },
      };
      function apply() {
        return rows.filter((row) => filters.every((filter) => filter(row)));
      }
      return builder;
    },
  };
}

function services(
  overrides: Partial<MatterBriefServices> = {},
): MatterBriefServices {
  return {
    completeText: vi.fn(async () => "As at 18 September 2026 (latest email thread: Northeon).\n\nTan wrote last and asked to finalise the MSA."),
    downloadFile: vi.fn(async () => new ArrayBuffer(8)),
    parseEmail: vi.fn(async () => ({
      subject: "Re: Northeon / Steadfast",
      from: [{ name: "Tan", address: "tan@example.com" }],
      to: [{ name: "Yule", address: "yule@attune.legal" }],
      cc: [],
      bcc: [],
      date: new Date("2026-09-18T03:00:00.000Z"),
      text: "Please mark up 260916 - Master Services Agreement (FreightOps) AL Markup.docx",
      html: null,
      attachments: [],
    })),
    writeMemoryFile: writeMemoryFile as MatterBriefServices["writeMemoryFile"],
    getUserModelSettings: vi.fn(async () => ({
      title_model: null,
      tabular_model: null,
      memory_curator_model: "claude-haiku-4-5",
      last_selected_chat_model: "gpt-5.6-sol",
      last_selected_reasoning_level: null,
      legal_research_us: false,
      legal_research_au: false,
      legal_research_au_energy: false,
      legal_research_au_vic: false,
      legal_research_au_cases: false,
      api_keys: {},
    })),
    ...overrides,
  };
}

beforeEach(() => {
  enqueueDbJob.mockReset().mockResolvedValue({ id: "queued", deduped: false });
  ensureMemoryFile.mockReset().mockResolvedValue(memoryFile("## Working notes\n- Keep this"));
  writeMemoryFile.mockReset().mockResolvedValue({
    applied: true,
    current: { revision: 4, content: "" },
  });
});

describe("enqueueProjectMatterBrief", () => {
  it("dedupes per project and waits for a burst of uploads", async () => {
    await enqueueProjectMatterBrief({} as never, PROJECT_ID);
    expect(enqueueDbJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: MATTER_BRIEF_JOB_KIND,
        payload: { projectId: PROJECT_ID },
        dedupeKey: `${MATTER_BRIEF_JOB_KIND}:${PROJECT_ID}`,
      }),
    );
    const runAt = new Date(
      (enqueueDbJob.mock.calls[0]![1] as { runAt: string }).runAt,
    ).getTime();
    expect(runAt).toBeGreaterThan(Date.now());
  });

  it("ignores a malformed project id", async () => {
    await enqueueProjectMatterBrief({} as never, "not-a-uuid");
    expect(enqueueDbJob).not.toHaveBeenCalled();
  });
});

describe("handleMemoryMatterBrief", () => {
  const documents = [
    {
      id: "email-1",
      current_version_id: "v-email",
      status: "ready",
      folder_id: "emails",
      created_at: "2026-09-18T03:00:00.000Z",
      project_id: PROJECT_ID,
    },
    {
      id: "msa-1",
      current_version_id: "v-msa",
      status: "ready",
      folder_id: "dr",
      created_at: "2026-09-16T00:00:00.000Z",
      project_id: PROJECT_ID,
    },
  ];
  const versions = [
    {
      id: "v-email",
      storage_path: "emails/1.eml",
      pdf_storage_path: null,
      version_number: 1,
      filename: "260918 - Re Northeon Steadfast.eml",
      source: "sharepoint_sync",
      file_type: "eml",
      size_bytes: 12,
      page_count: 1,
      content_sha256: "a",
      deleted_at: null,
    },
    {
      id: "v-msa",
      storage_path: "dr/msa.docx",
      pdf_storage_path: null,
      version_number: 1,
      filename: "260916 - Master Services Agreement (FreightOps) AL Markup.docx",
      source: "sharepoint_sync",
      file_type: "docx",
      size_bytes: 20,
      page_count: 8,
      content_sha256: "b",
      deleted_at: null,
    },
  ];

  function db() {
    return tableDb({
      projects: [
        {
          id: PROJECT_ID,
          user_id: "owner",
          name: "Northeon",
          client_name: "Steadfast",
          cm_number: "263334",
        },
      ],
      documents,
      document_versions: versions,
      project_subfolders: [
        { id: "emails", name: "Emails - Northeon", parent_folder_id: null, project_id: PROJECT_ID },
        { id: "dr", name: "DR - Northeon", parent_folder_id: null, project_id: PROJECT_ID },
      ],
    });
  }

  it("writes status, working files and index from the latest thread only", async () => {
    const svc = services();
    const result = await handleMemoryMatterBrief(db() as never, job({ projectId: PROJECT_ID }), svc);
    expect(result).toEqual({ applied: true, refreshed: false });
    expect(svc.completeText).toHaveBeenCalled();
    const user = (svc.completeText as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      .user as string;
    expect(user).toContain("Northeon / Steadfast");
    expect(user).not.toContain("chat");
    const written = writeMemoryFile.mock.calls[0]![0] as {
      content: string;
      source: string;
    };
    expect(written.source).toBe("manual");
    expect(written.content).toContain(MATTER_STATUS_START);
    expect(written.content).toContain("Tan wrote last");
    expect(written.content).toContain(
      "260916 - Master Services Agreement (FreightOps) AL Markup.docx",
    );
    expect(written.content).toContain("Emails - Northeon");
    expect(written.content).toContain("Keep this");
    expect(written.content).toContain(MATTER_STATUS_END);
  });

  it("skips the model when the same thread is already recorded", async () => {
    const svc = services();
    await handleMemoryMatterBrief(db() as never, job({ projectId: PROJECT_ID }), svc);
    const first = writeMemoryFile.mock.calls[0]![0] as { content: string };
    writeMemoryFile.mockClear();
    (svc.completeText as ReturnType<typeof vi.fn>).mockClear();
    ensureMemoryFile.mockResolvedValue(memoryFile(first.content));
    await handleMemoryMatterBrief(db() as never, job({ projectId: PROJECT_ID }), svc);
    expect(svc.completeText).not.toHaveBeenCalled();
    expect(writeMemoryFile.mock.calls[0]![0].content).toContain(
      "Tan wrote last",
    );
  });

  it("does not treat a missing project as a hard failure", async () => {
    const empty = tableDb({
      projects: [],
      documents: [],
      document_versions: [],
      project_subfolders: [],
    });
    await expect(
      handleMemoryMatterBrief(empty as never, job({ projectId: PROJECT_ID }), services()),
    ).resolves.toEqual({ skipped: "project_missing" });
    expect(writeMemoryFile).not.toHaveBeenCalled();
  });

  it("rebases once when a concurrent memory write wins the revision", async () => {
    writeMemoryFile
      .mockRejectedValueOnce(new MemoryRevisionConflictError("changed"))
      .mockResolvedValueOnce({ applied: true, current: { revision: 5 } });
    ensureMemoryFile
      .mockResolvedValueOnce(memoryFile())
      .mockResolvedValueOnce(memoryFile("## Working notes\n- Newer"));
    await handleMemoryMatterBrief(db() as never, job({ projectId: PROJECT_ID }), services());
    expect(writeMemoryFile).toHaveBeenCalledTimes(2);
    expect(writeMemoryFile.mock.calls[1]![0].content).toContain("Newer");
  });
});
