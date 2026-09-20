import { beforeEach, describe, expect, it, vi } from "vitest";
import { scriptedDb } from "../../../../../__tests__/helpers/scriptedDb";

const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
  acceptAll: vi.fn(),
  docxToPdf: vi.fn(),
  enqueueConversion: vi.fn(),
}));
vi.mock("../../../../../lib/documentVersions", () => ({
  loadActiveVersion: mocks.active,
  contentSha256: () => "hash",
}));
vi.mock("../../../../../lib/storage", () => ({
  downloadFile: mocks.downloadFile,
  uploadFile: mocks.uploadFile,
  storageKey: (userId: string, documentId: string, filename: string) =>
    `documents/${userId}/${documentId}/${filename}`,
  extractedTextKey: (id: string) => `text/${id}`,
  generatedDocKey: (id: string) => `generated/${id}`,
}));
vi.mock("../../../../../lib/docxTrackedChanges", () => ({
  acceptAllTrackedChanges: mocks.acceptAll,
  applyTrackedEdits: vi.fn(),
  extractDocxBodyText: vi.fn(),
  listTrackedChanges: vi.fn(),
}));
vi.mock("../../../../../lib/convert", () => ({
  convertedPdfKey: (userId: string, documentId: string) =>
    `pdf/${userId}/${documentId}.pdf`,
  docxToPdf: mocks.docxToPdf,
}));
vi.mock("../../../../../lib/queue/conversionQueue", () => ({
  enqueueConversion: mocks.enqueueConversion,
}));
vi.mock("../../../../../lib/downloadTokens", () => ({
  buildDownloadUrl: (path: string, filename: string) =>
    `download:${filename}:${path}`,
}));

import {
  cleanCopyFilename,
  formatTrackedChangesSection,
  runFinalizeDocument,
} from "../documentOps";

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.ASYNC_DOCUMENT_CONVERSION;
  mocks.active.mockResolvedValue({
    id: "active",
    filename: "260916 - MSA AL Markup.docx",
    storage_path: "current",
  });
  mocks.downloadFile.mockResolvedValue(new ArrayBuffer(4));
  mocks.acceptAll.mockResolvedValue({
    bytes: Buffer.from("clean"),
    accepted: 7,
    propertyChangesAccepted: 2,
    commentsRemoved: 3,
  });
  mocks.docxToPdf.mockResolvedValue(Buffer.from("pdf"));
});

describe("cleanCopyFilename", () => {
  it("appends (clean) to the source stem by default", () => {
    expect(cleanCopyFilename("260916 - MSA AL Markup.docx", null)).toBe(
      "260916 - MSA AL Markup (clean).docx",
    );
  });

  it("uses the requested name and forces the docx extension", () => {
    expect(cleanCopyFilename("Anything.docx", "MSA - execution copy.pdf")).toBe(
      "MSA - execution copy.docx",
    );
  });
});

describe("formatTrackedChangesSection", () => {
  it("lists pending changes with author and date and points at finalize_document", () => {
    const section = formatTrackedChangesSection({
      changes: [
        {
          w_id: "1",
          kind: "ins",
          author: "Tan",
          date: "2026-09-18T07:01:16Z",
          text: "with Steadfast's prior written approval",
        },
        { w_id: "2", kind: "del", author: null, date: null, text: "notify" },
      ],
      propertyChanges: 1,
      moves: 0,
      comments: 2,
    });
    expect(section).toContain("TRACKED CHANGES (3 pending, 2 comments)");
    expect(section).toContain(
      '1. [ins] Tan, 2026-09-18: "with Steadfast\'s prior written approval"',
    );
    expect(section).toContain('2. [del] unknown author: "notify"');
    expect(section).toContain("1 formatting change, 2 comments");
    expect(section).toContain("finalize_document");
  });

  it("says so plainly when there is no redline", () => {
    expect(
      formatTrackedChangesSection({
        changes: [],
        propertyChanges: 0,
        moves: 0,
        comments: 0,
      }),
    ).toContain("TRACKED CHANGES: none");
  });
});

describe("runFinalizeDocument", () => {
  it("saves the accepted bytes as a new project document and settles the source's edit cards", async () => {
    const fake = scriptedDb([
      { table: "documents", op: "insert", data: null },
      {
        rpc: "create_document_version",
        data: { id: "v-clean", version_number: 1 },
      },
      { table: "document_edits", op: "update", data: null },
    ]);

    const result = await runFinalizeDocument({
      sourceDocumentId: "src-doc",
      sourceFilename: "260916 - MSA AL Markup.docx",
      userId: "actor",
      projectId: "proj-1",
      newFilename: null,
      db: fake.db,
    });

    expect(result).toEqual({
      ok: true,
      filename: "260916 - MSA AL Markup (clean).docx",
      document_id: expect.any(String),
      version_id: "v-clean",
      version_number: 1,
      source_document_id: "src-doc",
      source_filename: "260916 - MSA AL Markup.docx",
      download_url: expect.stringContaining(
        "download:260916 - MSA AL Markup (clean).docx:",
      ),
      accepted: 9,
      comments_removed: 3,
    });
    fake.done();

    const documentId = (result as { document_id: string }).document_id;
    expect(mocks.uploadFile).toHaveBeenCalledWith(
      `documents/actor/${documentId}/260916 - MSA AL Markup (clean).docx`,
      expect.anything(),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(mocks.uploadFile).toHaveBeenCalledWith(
      `pdf/actor/${documentId}.pdf`,
      expect.anything(),
      "application/pdf",
    );

    const docInsert = fake.calls.find((c) => c.table === "documents");
    expect(docInsert?.payload).toMatchObject({
      id: documentId,
      project_id: "proj-1",
      user_id: "actor",
      status: "ready",
      library_kind: "file",
    });
    const version = fake.calls.find((c) => c.table === "create_document_version");
    expect(version?.args).toMatchObject({
      p_document_id: documentId,
      p_version: expect.objectContaining({
        filename: "260916 - MSA AL Markup (clean).docx",
        file_type: "docx",
        pdf_storage_path: `pdf/actor/${documentId}.pdf`,
      }),
    });
    const settle = fake.calls.find((c) => c.table === "document_edits");
    expect(settle?.payload).toEqual({ status: "accepted" });
    expect(settle?.filters).toEqual([
      ["eq", "document_id", "src-doc"],
      ["eq", "status", "pending"],
    ]);
  });

  it("queues the PDF rendition instead of converting inline when conversion is async", async () => {
    process.env.ASYNC_DOCUMENT_CONVERSION = "true";
    const fake = scriptedDb([
      { table: "documents", op: "insert", data: null },
      { rpc: "create_document_version", data: { id: "v-clean", version_number: 1 } },
      { table: "document_edits", op: "update", data: null },
    ]);

    const result = await runFinalizeDocument({
      sourceDocumentId: "src-doc",
      sourceFilename: "Draft.docx",
      userId: "actor",
      projectId: null,
      newFilename: "Draft - execution copy",
      db: fake.db,
    });

    expect(result.ok).toBe(true);
    expect(mocks.docxToPdf).not.toHaveBeenCalled();
    expect(mocks.enqueueConversion).toHaveBeenCalledWith(
      expect.objectContaining({
        versionId: "v-clean",
        fileType: "docx",
        finalizeDocumentStatus: false,
      }),
    );
    expect((result as { filename: string }).filename).toBe(
      "Draft - execution copy.docx",
    );
  });

  it("reports a missing source without touching the database", async () => {
    mocks.active.mockResolvedValue(null);
    const fake = scriptedDb([]);
    const result = await runFinalizeDocument({
      sourceDocumentId: "src-doc",
      sourceFilename: "Draft.docx",
      userId: "actor",
      projectId: null,
      newFilename: null,
      db: fake.db,
    });
    expect(result).toEqual({ ok: false, error: "Could not load document bytes." });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("rolls the document row back when its version cannot be recorded", async () => {
    const fake = scriptedDb([
      { table: "documents", op: "insert", data: null },
      { rpc: "create_document_version", data: null, error: { message: "boom" } },
      { table: "documents", op: "delete", data: null },
    ]);
    const result = await runFinalizeDocument({
      sourceDocumentId: "src-doc",
      sourceFilename: "Draft.docx",
      userId: "actor",
      projectId: null,
      newFilename: null,
      db: fake.db,
    });
    expect(result).toEqual({
      ok: false,
      error: "Failed to record the clean copy's version.",
    });
    fake.done();
  });
});
