import { describe, expect, it } from "vitest";
import { MEMORY_MAX_BYTES } from "../files";
import {
  buildMatterStatusMarkdown,
  extractMatterStatusMeta,
  extractMatterStatusSection,
  groupDocumentsForIndex,
  mergeMatterStatusIntoMemory,
  namedWorkingFiles,
  normalizeEmailSubject,
  parseFilenameTimestamp,
  preserveMatterStatusSection,
  selectLatestEmailThread,
  threadFingerprint,
  type MatterDocument,
} from "../matterStatus";

function doc(
  id: string,
  filename: string,
  fileType: string,
  createdAt = "2026-09-10T00:00:00.000Z",
  folderPath = "",
): MatterDocument {
  return {
    id,
    filename,
    fileType,
    createdAt,
    folderPath,
    storagePath: `docs/${id}`,
  };
}

describe("normalizeEmailSubject", () => {
  it("strips reply prefixes and noise so a thread groups together", () => {
    expect(normalizeEmailSubject("Re: Re: Northeon / Steadfast MSA")).toBe(
      "northeon / steadfast msa",
    );
    expect(
      normalizeEmailSubject(
        "Important correspondence from Northeon / Steadfast MSA",
      ),
    ).toBe("northeon / steadfast msa");
    expect(normalizeEmailSubject("Fw: Fwd: SOW warranty")).toBe("sow warranty");
  });
});

describe("parseFilenameTimestamp", () => {
  it("reads the latest YYMMDD stamp in a Colleague filename", () => {
    expect(
      parseFilenameTimestamp(
        "260916 - Statement of Work - FreightOps - updated 260918.docx",
      )?.toISOString(),
    ).toBe("2026-09-18T00:00:00.000Z");
    expect(parseFilenameTimestamp("not-dated.eml")).toBeNull();
    expect(parseFilenameTimestamp("261332 - impossible.docx")).toBeNull();
  });
});

describe("selectLatestEmailThread", () => {
  it("uses the newest parsed date, not a single isolated email", () => {
    const older = doc("1", "260901 - JV close.eml", "eml", "2026-09-01T00:00:00Z");
    const reply = doc(
      "2",
      "260918 - Re Northeon Steadfast.eml",
      "eml",
      "2026-09-18T03:00:00Z",
    );
    const earlier = doc(
      "3",
      "260916 - Northeon Steadfast.eml",
      "eml",
      "2026-09-16T00:00:00Z",
    );
    const thread = selectLatestEmailThread(
      [older, reply, earlier],
      new Map([
        ["1", { subject: "JV close", date: new Date("2026-09-01T00:00:00Z") }],
        [
          "2",
          {
            subject: "Re: Northeon / Steadfast",
            date: new Date("2026-09-18T03:00:00Z"),
          },
        ],
        [
          "3",
          {
            subject: "Northeon / Steadfast",
            date: new Date("2026-09-16T00:00:00Z"),
          },
        ],
      ]),
    );
    expect(thread?.normalizedSubject).toBe("northeon / steadfast");
    expect(thread?.documents.map((item) => item.id)).toEqual(["3", "2"]);
    expect(thread?.fingerprint).toBe(
      threadFingerprint(thread!.documents, "northeon / steadfast"),
    );
  });
});

describe("index and working set", () => {
  it("groups by folder when the sync laid one down", () => {
    const groups = groupDocumentsForIndex([
      doc(
        "1",
        "note.eml",
        "eml",
        "2026-09-18T00:00:00Z",
        "Emails - Northeon",
      ),
      doc(
        "2",
        "260916 - Master Services Agreement.docx",
        "docx",
        "2026-09-16T00:00:00Z",
        "DR - Northeon",
      ),
      doc(
        "3",
        "260910 - Master Services Agreement.docx",
        "docx",
        "2026-09-10T00:00:00Z",
        "DR - Northeon",
      ),
    ]);
    expect(groups).toEqual([
      expect.objectContaining({
        label: "DR - Northeon",
        count: 2,
        latestFilename: "260916 - Master Services Agreement.docx",
      }),
      expect.objectContaining({
        label: "Emails - Northeon",
        count: 1,
      }),
    ]);
  });

  it("picks drafts named in the thread and ignores emails", () => {
    const msa = doc("m", "260916 - Master Services Agreement (FreightOps).docx", "docx");
    const sow = doc("s", "260916 - Statement of Work - FreightOps.docx", "docx");
    const old = doc("o", "240101 - JV agreement.docx", "docx");
    const named = namedWorkingFiles(
      [msa, sow, old],
      "Please mark up the Master Services Agreement (FreightOps) and the Statement of Work - FreightOps",
      [],
    );
    expect(named.map((item) => item.id)).toEqual(["m", "s"]);
  });
});

describe("matter-status merge", () => {
  it("replaces the fenced block and keeps curator notes", () => {
    const previous = [
      "<!-- matter-status:start -->",
      "old status",
      "<!-- matter-status:end -->",
      "",
      "## Working notes",
      "- Prefer short emails",
    ].join("\n");
    const next = [
      "<!-- matter-status:start -->",
      "new status",
      "<!-- matter-status:end -->",
    ].join("\n");
    expect(mergeMatterStatusIntoMemory(previous, next)).toContain("new status");
    expect(mergeMatterStatusIntoMemory(previous, next)).toContain(
      "Prefer short emails",
    );
    expect(extractMatterStatusSection(mergeMatterStatusIntoMemory(previous, next))).toContain(
      "new status",
    );
  });

  it("restores the previous block when the curator drops it", () => {
    const section = [
      "<!-- matter-status:start -->",
      "As at 18 September 2026.",
      "<!-- matter-status:end -->",
    ].join("\n");
    const preserved = preserveMatterStatusSection(
      `${section}\n\n## Working notes\n- Keep`,
      "## Working notes\n- Keep\n- New chat guess",
    );
    expect(extractMatterStatusSection(preserved)).toBe(section);
    expect(preserved).toContain("New chat guess");
  });

  it("records a thread fingerprint the next pass can reuse", () => {
    const markdown = buildMatterStatusMarkdown({
      statusParagraphs: "Tan wrote last and asked to finalise the MSA.",
      workingFiles: [
        doc("m", "260916 - Master Services Agreement.docx", "docx"),
      ],
      workingFilesFromThread: true,
      index: [
        {
          label: "Correspondence",
          count: 2,
          latestFilename: "260918 - Re Northeon.eml",
          latestDate: new Date("2026-09-18T00:00:00Z"),
        },
      ],
      thread: {
        subject: "Northeon / Steadfast",
        normalizedSubject: "northeon / steadfast",
        documents: [
          doc("e", "260918 - Re Northeon.eml", "eml", "2026-09-18T00:00:00Z"),
        ],
        fingerprint: "abc123",
      },
      generatedAt: new Date("2026-09-20T06:00:00.000Z"),
    });
    expect(extractMatterStatusMeta(markdown)).toEqual({
      thread: "abc123",
      generated: "2026-09-20T06:00:00.000Z",
    });
    expect(markdown).toContain("# Where the matter sits");
    expect(markdown).toContain("## Current working files");
    expect(markdown).toContain("## Matter index");
  });

  it("keeps the fenced block when notes would overflow the file cap", () => {
    const section = [
      "<!-- matter-status:start -->",
      "status",
      "<!-- matter-status:end -->",
    ].join("\n");
    const notes = "n".repeat(MEMORY_MAX_BYTES);
    const merged = mergeMatterStatusIntoMemory(notes, section);
    expect(extractMatterStatusSection(merged)).toContain("status");
    expect(Buffer.byteLength(merged, "utf8")).toBeLessThanOrEqual(MEMORY_MAX_BYTES);
  });
});
