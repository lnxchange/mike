// Paragraph styles present in a .docx (word/styles.xml).
//
// The model should only use style names that already exist in the file it is
// editing. This helper lists them. It does not invent Attune (or any other
// firm) names.

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export type DocxParagraphStyle = {
  id: string;
  name: string;
};

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function zipEntry(zip: JSZip, pathSlash: string) {
  return zip.file(pathSlash) ?? zip.file(pathSlash.replace(/\//g, "\\"));
}

export async function extractDocxParagraphStyles(
  bytes: Buffer,
): Promise<DocxParagraphStyle[]> {
  const zip = await JSZip.loadAsync(bytes);
  const stylesFile = zipEntry(zip, "word/styles.xml");
  if (!stylesFile) return [];
  const raw = await stylesFile.async("string");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
  });
  const tree = parser.parse(raw) as {
    "w:styles"?: { "w:style"?: unknown };
    styles?: { style?: unknown };
  };
  const nodes = asArray(
    tree["w:styles"]?.["w:style"] ?? tree.styles?.style,
  ) as Array<Record<string, unknown>>;
  const seen = new Set<string>();
  const styles: DocxParagraphStyle[] = [];
  for (const node of nodes) {
    const type = String(node["@_w:type"] ?? node["@_type"] ?? "");
    if (type && type !== "paragraph") continue;
    const id = String(node["@_w:styleId"] ?? node["@_styleId"] ?? "").trim();
    if (!id || seen.has(id)) continue;
    const nameNode = node["w:name"] ?? node.name;
    const name =
      (nameNode &&
        typeof nameNode === "object" &&
        (String(
          (nameNode as { "@_w:val"?: string; "@_val"?: string })["@_w:val"] ??
            (nameNode as { "@_val"?: string })["@_val"] ??
            "",
        ).trim() ||
          null)) ||
      id;
    seen.add(id);
    styles.push({ id, name });
  }
  return styles;
}

export function formatDocxParagraphStylesSection(
  styles: DocxParagraphStyle[],
): string {
  if (styles.length === 0) return "";
  const lines = styles.map((style) =>
    style.name === style.id
      ? `- ${style.name}`
      : `- ${style.name} (${style.id})`,
  );
  return `\n\n--- PARAGRAPH STYLES IN THIS DOCUMENT ---\n${lines.join("\n")}\nUse only these paragraph styles. Do not introduce Heading 1-4, Normal-as-body, or any other style that is not listed.`;
}
