import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  docxToPdf: vi.fn(),
}));

vi.mock("../storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage")>();
  return { ...actual, downloadFile: mocks.downloadFile };
});

vi.mock("../convert", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../convert")>();
  return { ...actual, docxToPdf: mocks.docxToPdf };
});

import {
  loadDocumentDisplay,
  sendDocumentDisplay,
} from "../documentDisplay";

describe("loadDocumentDisplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.downloadFile.mockResolvedValue(Buffer.from("source"));
    mocks.docxToPdf.mockResolvedValue(Buffer.from("converted"));
  });

  it.each(["doc", "docx", "ppt", "pptx"])(
    "converts an unrendered %s file to PDF",
    async (fileType) => {
      const result = await loadDocumentDisplay({
        filename: `Asset.${fileType}`,
        fileType,
        storagePath: `asset.${fileType}`,
      });

      expect(mocks.downloadFile).toHaveBeenCalledWith(`asset.${fileType}`);
      expect(mocks.docxToPdf).toHaveBeenCalledOnce();
      expect(result).toEqual({
        bytes: Buffer.from("converted"),
        contentType: "application/pdf",
        filename: "Asset.pdf",
      });
    },
  );

  it("uses a persisted PDF rendition without converting again", async () => {
    const result = await loadDocumentDisplay({
      filename: "Asset.pptx",
      fileType: "pptx",
      storagePath: "asset.pptx",
      pdfStoragePath: "asset.pdf",
    });

    expect(mocks.downloadFile).toHaveBeenCalledWith("asset.pdf");
    expect(mocks.docxToPdf).not.toHaveBeenCalled();
    expect(result?.contentType).toBe("application/pdf");
  });

  it("falls back to converting the source when a persisted rendition is missing", async () => {
    mocks.downloadFile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(Buffer.from("source"));

    const result = await loadDocumentDisplay({
      filename: "Asset.doc",
      fileType: "doc",
      storagePath: "asset.doc",
      pdfStoragePath: "missing.pdf",
    });

    expect(mocks.downloadFile).toHaveBeenNthCalledWith(1, "missing.pdf");
    expect(mocks.downloadFile).toHaveBeenNthCalledWith(2, "asset.doc");
    expect(mocks.docxToPdf).toHaveBeenCalledOnce();
    expect(result?.bytes).toEqual(Buffer.from("converted"));
  });

  it("serves spreadsheets unchanged", async () => {
    const result = await loadDocumentDisplay({
      filename: "Asset.xlsx",
      fileType: "xlsx",
      storagePath: "asset.xlsx",
    });

    expect(mocks.docxToPdf).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      bytes: Buffer.from("source"),
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: "Asset.xlsx",
    });
  });
});

describe("sendDocumentDisplay", () => {
  it("marks the payload uncacheable so viewers cannot receive an empty 304", () => {
    const headers = new Map<string, string>();
    const res = {
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), value);
      },
      send: vi.fn(),
    };
    sendDocumentDisplay(res as never, {
      bytes: Buffer.from("%PDF-1"),
      contentType: "application/pdf",
      filename: "Letter.pdf",
    });
    expect(headers.get("cache-control")).toBe("private, no-store");
    expect(headers.get("content-type")).toBe("application/pdf");
    expect(res.send).toHaveBeenCalledWith(Buffer.from("%PDF-1"));
  });
});
