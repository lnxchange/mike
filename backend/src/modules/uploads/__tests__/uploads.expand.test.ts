import { describe, expect, it } from "vitest";

import { derivedDocumentId } from "../uploads.expand";

describe("derivedDocumentId", () => {
  it("is stable for the same upload file and child path", () => {
    const a = derivedDocumentId("file-1", "archive:0/Correspondence/letter.pdf");
    const b = derivedDocumentId("file-1", "archive:0/Correspondence/letter.pdf");
    expect(a).toBe(b);
  });

  it("differs across files and across children", () => {
    const base = derivedDocumentId("file-1", "archive:0/a.pdf");
    expect(derivedDocumentId("file-2", "archive:0/a.pdf")).not.toBe(base);
    expect(derivedDocumentId("file-1", "archive:0/b.pdf")).not.toBe(base);
  });

  it("is a well-formed UUID with the version and variant bits set", () => {
    const id = derivedDocumentId("ns", "key");
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
