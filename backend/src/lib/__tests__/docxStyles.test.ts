import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  extractDocxParagraphStyles,
  formatDocxParagraphStylesSection,
} from "../docxStyles";

async function zipWithStyles(xml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word/styles.xml", xml);
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

describe("extractDocxParagraphStyles", () => {
  it("lists paragraph styles by display name and id", async () => {
    const bytes = await zipWithStyles(`<?xml version="1.0" encoding="UTF-8"?>
      <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:style w:type="paragraph" w:styleId="ALH1">
          <w:name w:val="AL H1"/>
        </w:style>
        <w:style w:type="paragraph" w:styleId="ALParticluars1">
          <w:name w:val="AL Particluars 1"/>
        </w:style>
        <w:style w:type="character" w:styleId="Strong">
          <w:name w:val="Strong"/>
        </w:style>
      </w:styles>`);
    await expect(extractDocxParagraphStyles(bytes)).resolves.toEqual([
      { id: "ALH1", name: "AL H1" },
      { id: "ALParticluars1", name: "AL Particluars 1" },
    ]);
  });

  it("returns an empty list when styles.xml is missing", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document/>");
    const bytes = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
    await expect(extractDocxParagraphStyles(bytes)).resolves.toEqual([]);
  });
});

describe("formatDocxParagraphStylesSection", () => {
  it("renders the model-facing inventory", () => {
    expect(
      formatDocxParagraphStylesSection([
        { id: "ALH1", name: "AL H1" },
        { id: "Quote", name: "Quote" },
      ]),
    ).toContain("PARAGRAPH STYLES IN THIS DOCUMENT");
    expect(
      formatDocxParagraphStylesSection([{ id: "ALH1", name: "AL H1" }]),
    ).toContain("- AL H1 (ALH1)");
    expect(formatDocxParagraphStylesSection([])).toBe("");
  });
});
