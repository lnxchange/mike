import { describe, expect, it } from "vitest";
import {
  folderUrlFromSharepointDocumentUrl,
  normalizeHttpUrl,
} from "../httpUrl";

describe("normalizeHttpUrl", () => {
  it("keeps an http(s) URL", () => {
    expect(normalizeHttpUrl(" https://example.com/a ")).toBe(
      "https://example.com/a",
    );
  });

  it("rejects a non-http value", () => {
    expect(normalizeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeHttpUrl("not-a-url")).toBeNull();
  });
});

describe("folderUrlFromSharepointDocumentUrl", () => {
  it("strips the file name from a matter-folder path", () => {
    expect(
      folderUrlFromSharepointDocumentUrl(
        "https://attunelegal.sharepoint.com/sites/AttuneLegal/Shared%20Documents/Clients/Blue%20NRG%20Group%20Pty%20Ltd/Blue%20NRG/23-0011%20-%20ACCC%20-%20s155%20Notice%20and%20Enforcement/Blue%20NRG%20s155%20Response.pdf",
      ),
    ).toBe(
      "https://attunelegal.sharepoint.com/sites/AttuneLegal/Shared%20Documents/Clients/Blue%20NRG%20Group%20Pty%20Ltd/Blue%20NRG/23-0011%20-%20ACCC%20-%20s155%20Notice%20and%20Enforcement",
    );
  });

  it("walks up from Emails and DR children", () => {
    expect(
      folderUrlFromSharepointDocumentUrl(
        "https://attunelegal.sharepoint.com/sites/AttuneLegal/Shared Documents/Clients/Blue NRG/23-0011 - ACCC/Emails - ACCC/note.eml",
      ),
    ).toBe(
      "https://attunelegal.sharepoint.com/sites/AttuneLegal/Shared%20Documents/Clients/Blue%20NRG/23-0011%20-%20ACCC",
    );
  });

  it("ignores Office viewer links", () => {
    expect(
      folderUrlFromSharepointDocumentUrl(
        "https://attunelegal.sharepoint.com/sites/AttuneLegal/_layouts/15/Doc.aspx?sourcedoc=%7Babc%7D&file=draft.docx",
      ),
    ).toBeNull();
  });
});
