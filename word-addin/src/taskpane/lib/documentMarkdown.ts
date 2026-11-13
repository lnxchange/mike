// Structure-annotated markdown rendering of the active Word document.
//
// The add-in sends the document to Mike as `document_context`. A flat
// `body.text` loses everything Word knows about structure — headings, list
// nesting, tables — so the model reads a contract's clause hierarchy as an
// undifferentiated wall of text and a table as run-together cells.
//
// This renderer adds structure WITHOUT changing the text itself, because two
// downstream contracts depend on the model quoting document text verbatim:
// edit blocks (deleted_text is located with Word's search API) and citations
// (clicked quotes are located the same way). Every rule here is therefore
// additive-only:
//   - heading paragraphs gain a leading "# " marker (never inline emphasis —
//     `**bold**` would teach the model to quote characters that exist
//     nowhere in the document);
//   - list items gain their list label inside « », plus indentation. The
//     guillemets are the signal that the label is Word's, not typed text.
//     A numbered heading is «style:1.», so `## «style:1.» 2 Liability`
//     keeps the style's number distinct from the typed "2".
//   - tables are rendered as pipe tables from their cell values.
// The paragraph/cell text between the markers stays byte-identical to what
// Word.search can find, and stripStructuralMarkers() undoes exactly these
// markers when a model quotes one anyway.

export type DocumentBlock =
  | {
      kind: "paragraph";
      text: string;
      /** Word.Style built-in name, e.g. "Heading1", "Title", "Normal". */
      styleBuiltIn?: string;
      /** The style name Word shows, used to reapply that style. */
      style?: string;
      /**
       * Bold text at the start of a definitions paragraph, when the term is
       * not already introduced with "means".
       */
      boldLead?: string;
      /** The list label Word renders, e.g. "1." or "•". */
      listString?: string;
      /** 0-based list nesting level. */
      listLevel?: number;
    }
  | { kind: "table"; values: string[][] };

const HEADING_LEVEL_BY_STYLE: Record<string, number> = {
  Title: 1,
  Heading1: 1,
  Heading2: 2,
  Heading3: 3,
  Heading4: 4,
  Heading5: 5,
  Heading6: 6,
};

/** Word reports paragraph/cell text with host-dependent trailing breaks. */
function stripTrailingBreaks(text: string): string {
  return text.replace(/[\r\n\v]+$/g, "");
}

/** "1." / "a)" style labels render as themselves; bullet glyphs become "-". */
function listMarker(listString: string | undefined): string {
  if (listString && /^[0-9A-Za-z]{1,4}[.)]$/.test(listString)) {
    return listString;
  }
  return "-";
}

/**
 * Word's own list label, wrapped so it cannot be mistaken for typed text.
 * `styleOwned` means the label comes from the paragraph style (a numbered
 * heading), which is the numbering to keep when the text also has a typed
 * number.
 */
function listAnnotation(
  listString: string | undefined,
  styleOwned: boolean,
): string {
  const marker = listMarker(listString);
  return styleOwned ? `«style:${marker}»` : `«${marker}»`;
}

function renderTable(values: string[][]): string[] {
  const rows = values.map(
    (cells) =>
      `| ${cells
        .map((cell) =>
          // Newlines inside a cell would break the row line. Multi-line cell
          // passages are unsearchable for edits anyway (Word.search rejects
          // paragraph breaks), so flattening loses nothing locatable.
          stripTrailingBreaks(cell).replace(/[\r\n\v]+/g, " "),
        )
        .join(" | ")} |`,
  );
  const [headerRow, ...bodyRows] = rows;
  if (headerRow === undefined) return [];
  const columns = values[0]?.length ?? 1;
  const separator = `|${Array.from({ length: columns }, () => " --- ").join("|")}|`;
  return [headerRow, separator, ...bodyRows];
}

const DEFINITION_HEADING =
  /^(?:definitions?|interpretation|defined terms)$/i;
const MAX_DEFINED_TERMS = 80;
const MAX_DEFINITION_CHARS = 160;
const MAX_NUMBERED_STYLES = 12;

function paragraphPlainText(block: Extract<DocumentBlock, { kind: "paragraph" }>): string {
  return stripTrailingBreaks(block.text).trim();
}

function headingLevelOf(
  block: Extract<DocumentBlock, { kind: "paragraph" }>,
): number | undefined {
  return block.styleBuiltIn
    ? HEADING_LEVEL_BY_STYLE[block.styleBuiltIn]
    : undefined;
}

function styleDisplayName(
  block: Extract<DocumentBlock, { kind: "paragraph" }>,
): string {
  const named = block.style?.trim();
  if (named) return named;
  return block.styleBuiltIn?.trim() || "Normal";
}

/** Styles that already number their paragraphs, one row per distinct pattern. */
export function numberingStyleLegend(blocks: DocumentBlock[]): string {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const block of blocks) {
    if (block.kind !== "paragraph" || block.listString === undefined) continue;
    if (listMarker(block.listString) === "-") continue;
    const name = styleDisplayName(block);
    const level = block.listLevel ?? 0;
    const label = listMarker(block.listString);
    const key = `${name}\0${level}\0${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(`- ${name}, level ${level}, ${label}`);
    if (rows.length >= MAX_NUMBERED_STYLES) break;
  }
  if (rows.length === 0) return "";
  return `NUMBERED STYLES\n${rows.join("\n")}`;
}

function definitionHeadingText(text: string): string {
  return text.replace(/^\d+(?:\.\d+)*\s+/, "").trim();
}

type DefinedTerm = { term: string; definition: string };

/** First bold run at the start of a paragraph, from Word OOXML. */
export function boldLeadFromOoxml(ooxml: string): string | null {
  const runs = ooxml.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g);
  let lead = "";
  let started = false;
  for (const run of runs) {
    const body = run[1] ?? "";
    const bold =
      /<w:b\b/.test(body) &&
      !/<w:b\b[^>]*w:val="(?:0|false|off)"/.test(body);
    const pieces = [...body.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(
      (match) =>
        (match[1] ?? "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"'),
    );
    const value = pieces.join("");
    if (!value.trim() && !started) continue;
    if (!bold) {
      if (started) break;
      return null;
    }
    started = true;
    lead += value;
  }
  const trimmed = lead.trim().replace(/[":“”]+$/g, "").trim();
  if (trimmed.length < 2 || trimmed.length > 80) return null;
  return trimmed;
}

function cleanDefinition(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_DEFINITION_CHARS) return flat;
  return `${flat.slice(0, MAX_DEFINITION_CHARS - 1).trimEnd()}…`;
}

function termFromParagraph(
  block: Extract<DocumentBlock, { kind: "paragraph" }>,
): DefinedTerm | null {
  const text = paragraphPlainText(block);
  if (!text) return null;
  const quoted = /^[“"']([^“"']{1,80})[”"']\s+means\b\s*([\s\S]*)$/i.exec(text);
  if (quoted?.[1]) {
    return {
      term: quoted[1].trim(),
      definition: cleanDefinition(quoted[2] ?? ""),
    };
  }
  const means = /^([A-Z][^.\n]{0,80}?)\s+means\b\s*([\s\S]*)$/.exec(text);
  if (means?.[1] && !DEFINITION_HEADING.test(means[1].trim())) {
    return {
      term: means[1].trim(),
      definition: cleanDefinition(means[2] ?? ""),
    };
  }
  const lead = block.boldLead?.trim();
  if (!lead || lead.length > 80) return null;
  if (!text.toLowerCase().startsWith(lead.toLowerCase())) return null;
  const rest = text.slice(lead.length).replace(/^[\s:–—-]+/, "");
  if (!rest) return null;
  return { term: lead, definition: cleanDefinition(rest) };
}

/** Defined terms from a definitions or interpretation section. Capped. */
export function definedTermIndex(blocks: DocumentBlock[]): string {
  let start = -1;
  let startLevel = 1;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block || block.kind !== "paragraph") continue;
    const text = definitionHeadingText(paragraphPlainText(block));
    if (!DEFINITION_HEADING.test(text)) continue;
    start = index;
    startLevel = headingLevelOf(block) ?? 1;
    break;
  }
  if (start < 0) return "";
  const terms: DefinedTerm[] = [];
  const seen = new Set<string>();
  for (let index = start + 1; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block || block.kind !== "paragraph") continue;
    const level = headingLevelOf(block);
    if (level !== undefined && level <= startLevel) break;
    const term = termFromParagraph(block);
    if (!term) continue;
    const key = term.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= MAX_DEFINED_TERMS) break;
  }
  if (terms.length === 0) return "";
  const rows = terms.map(
    (term) => `- ${term.term}${term.definition ? `: ${term.definition}` : ""}`,
  );
  return `DEFINITIONS\n${rows.join("\n")}`;
}

export function renderDocumentMarkdown(blocks: DocumentBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.kind === "table") {
      // Pipe tables need blank-line separation to parse as tables.
      if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
      lines.push(...renderTable(block.values));
      lines.push("");
      continue;
    }
    const text = stripTrailingBreaks(block.text);
    const headingLevel = block.styleBuiltIn
      ? HEADING_LEVEL_BY_STYLE[block.styleBuiltIn]
      : undefined;
    // A numbered heading style owns its list label. A bullet on a heading
    // is direct formatting, not that style's numbering.
    const styleOwned =
      headingLevel !== undefined &&
      block.listString !== undefined &&
      listMarker(block.listString) !== "-";
    const annotation =
      block.listString !== undefined
        ? `${listAnnotation(block.listString, styleOwned)} `
        : "";
    if (headingLevel !== undefined && text.trim()) {
      lines.push(`${"#".repeat(headingLevel)} ${annotation}${text}`);
      continue;
    }
    if (block.listString !== undefined) {
      const indent = "  ".repeat(Math.max(0, block.listLevel ?? 0));
      lines.push(`${indent}${annotation}${text}`);
      continue;
    }
    lines.push(text);
  }
  const body = lines.join("\n");
  const brief = [numberingStyleLegend(blocks), definedTermIndex(blocks)]
    .filter(Boolean)
    .join("\n\n");
  return brief ? `${brief}\n\n${body}` : body;
}

const MAX_SELECTION_CHARS = 1500;

/** Prepend the user's selection when it is a real passage, not the whole document. */
export function withDocumentSelection(
  markdown: string,
  selection: string | null | undefined,
): string {
  const value = (selection ?? "").replace(/[\r\n\v]+/g, "\n").trim();
  if (!value || value.length > MAX_SELECTION_CHARS) return markdown;
  if (markdown.includes(value) && value.length > markdown.length * 0.8) {
    return markdown;
  }
  return `SELECTION\n${value}\n\n${markdown}`;
}

/**
 * Undo the renderer's structural markers from a model-quoted passage.
 *
 * The prompt tells the model that heading marks, list markers, and table
 * pipes are annotations, not document text — but a model quoting a heading
 * line sometimes copies them anyway. This strips exactly what
 * renderDocumentMarkdown adds (leading indent, a heading mark, a «label»
 * list annotation, or single-cell pipe framing) so callers can retry a
 * failed verbatim search. Returns null when nothing was stripped, so
 * callers never re-search the same string.
 */
export function stripStructuralMarkers(quoted: string): string | null {
  let text = quoted;
  const framedCell = /^\s*\|(.*)\|\s*$/.exec(text)?.[1];
  if (framedCell !== undefined && !framedCell.includes("|")) {
    // "| cell text |" — a single-cell quote. Multi-cell quotes span cell
    // boundaries and are unlocatable regardless.
    text = framedCell.trim();
  }
  const unindented = text.replace(/^\s+/, "");
  // A heading mark and a «label» may both be present (`## «1.» 2 Liability`).
  // The guillemets cannot occur in the paragraph text, so stripping them
  // after the heading mark cannot eat a typed number. A bare "1. " is only
  // stripped when nothing else was, because on a heading line that "1." may
  // be the typed number the renderer left in place.
  let stripped = unindented;
  const heading = /^(?:#{1,6} )/.exec(stripped);
  if (heading) stripped = stripped.slice(heading[0].length);
  const annotation = /^«[^»\n]+» /.exec(stripped);
  if (annotation) stripped = stripped.slice(annotation[0].length);
  if (stripped === unindented) {
    const legacy = /^(?:[-*] |[0-9A-Za-z]{1,4}[.)] )/.exec(stripped);
    if (legacy) stripped = stripped.slice(legacy[0].length);
  }
  text = stripped;
  return text === quoted ? null : text;
}
