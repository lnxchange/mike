import { describe, expect, it } from "vitest";
import {
  boldLeadFromOoxml,
  definedTermIndex,
  numberingStyleLegend,
  renderDocumentMarkdown,
  withDocumentSelection,
  type DocumentBlock,
} from "../../../word-addin/src/taskpane/lib/documentMarkdown";

const blocks: DocumentBlock[] = [
  {
    kind: "paragraph",
    text: "Definitions",
    style: "Heading 1",
    styleBuiltIn: "Heading1",
  },
  {
    kind: "paragraph",
    text: '"Affiliate" means a controlled entity.',
    style: "Normal",
  },
  {
    kind: "paragraph",
    text: "Supplier a party that supplies goods",
    style: "Normal",
    boldLead: "Supplier",
  },
  {
    kind: "paragraph",
    text: "2 Liability",
    style: "Heading 2",
    styleBuiltIn: "Heading2",
    listString: "1.",
    listLevel: 0,
  },
];

describe("document brief", () => {
  it("lists numbered styles from the paragraphs that use them", () => {
    expect(numberingStyleLegend(blocks)).toBe(
      "NUMBERED STYLES\n- Heading 2, level 0, 1.",
    );
  });

  it("indexes quoted terms and bold lead-ins until the next heading", () => {
    expect(definedTermIndex(blocks)).toBe(
      "DEFINITIONS\n- Affiliate: a controlled entity.\n- Supplier: a party that supplies goods",
    );
  });

  it("puts the brief ahead of the body and keeps a short selection", () => {
    const markdown = renderDocumentMarkdown(blocks);
    expect(markdown.startsWith("NUMBERED STYLES\n")).toBe(true);
    expect(markdown).toContain("## «style:1.» 2 Liability");
    expect(withDocumentSelection(markdown, "a controlled entity")).toContain(
      "SELECTION\na controlled entity",
    );
    expect(withDocumentSelection(markdown, "")).toBe(markdown);
  });

  it("reads a bold lead from paragraph OOXML", () => {
    const ooxml = `<w:r><w:rPr><w:b/></w:rPr><w:t>Supplier</w:t></w:r><w:r><w:t> means a party</w:t></w:r>`;
    expect(boldLeadFromOoxml(ooxml)).toBe("Supplier");
  });
});
