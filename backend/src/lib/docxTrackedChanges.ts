/**
 * DOCX tracked-changes helpers.
 *
 * `applyTrackedEdits` rewrites a .docx so that the requested substitutions
 * appear as `<w:ins>` / `<w:del>` tracked changes rather than direct text
 * replacements. `resolveTrackedChange` accepts or rejects one change by
 * its `w:id`, producing a new .docx with only that change collapsed.
 *
 * Only text inside `<w:p><w:r><w:t>` is considered. Headers, footers,
 * comments, footnotes are left alone. Pre-existing tracked changes in the
 * paragraph are presented to the matcher in *accepted view*: w:ins runs are
 * treated as normal text, w:del wrappers are invisible. A new edit that
 * lands inside a pre-existing w:ins keeps that insertion's author on every
 * character it does not itself change, and records only the new insertion
 * or deletion under the current author.
 */

import JSZip from "jszip";
import { XMLParser, XMLBuilder } from "fast-xml-parser";

// ---------------------------------------------------------------------------
// JSZip path helpers
// ---------------------------------------------------------------------------
//
// Some older Windows/Word archives store entries with backslash path
// separators (e.g. `word\document.xml`) even though the zip spec requires
// forward slashes. JSZip looks up entries by exact string, so
// `zip.file("word/document.xml")` misses those files. These helpers accept
// the canonical forward-slash form and transparently fall back to the
// backslash variant for both reads and writes.

function getZipEntry(zip: JSZip, pathSlash: string) {
    const direct = zip.file(pathSlash);
    if (direct) return direct;
    return zip.file(pathSlash.replace(/\//g, "\\"));
}

function setZipEntry(
    zip: JSZip,
    pathSlash: string,
    content: string | Buffer,
): void {
    const backslash = pathSlash.replace(/\//g, "\\");
    // If the archive already stores the entry under backslashes, keep it
    // there so we don't emit both variants side by side.
    if (!zip.file(pathSlash) && zip.file(backslash)) {
        zip.file(backslash, content);
        return;
    }
    zip.file(pathSlash, content);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EditInput {
    find: string;
    replace: string;
    context_before: string;
    context_after: string;
    reason?: string;
}

export interface AppliedChange {
    id: string;
    delId?: string;
    insId?: string;
    deletedText: string;
    insertedText: string;
    contextBefore: string;
    contextAfter: string;
    reason?: string;
}

export interface EditError {
    index: number;
    reason: string;
}

export interface ApplyTrackedEditsResult {
    bytes: Buffer;
    changes: AppliedChange[];
    errors: EditError[];
}

// ---------------------------------------------------------------------------
// Preserve-order tree helpers
// ---------------------------------------------------------------------------

type XNode = Record<string, unknown>;

const ATTR_KEY = ":@";
const TEXT_KEY = "#text";

function elName(n: unknown): string | null {
    if (!n || typeof n !== "object") return null;
    for (const k of Object.keys(n as XNode)) {
        if (k === ATTR_KEY || k === TEXT_KEY) continue;
        return k;
    }
    return null;
}

function isTextNode(n: unknown): n is { [TEXT_KEY]: string } {
    if (!n || typeof n !== "object") return false;
    const obj = n as XNode;
    return TEXT_KEY in obj && elName(n) === null;
}

function elChildren(n: unknown): XNode[] {
    const name = elName(n);
    if (!name) return [];
    const v = (n as XNode)[name];
    return Array.isArray(v) ? (v as XNode[]) : [];
}

function setChildren(n: XNode, children: XNode[]): void {
    const name = elName(n);
    if (!name) return;
    n[name] = children;
}

function elAttrs(n: unknown): Record<string, string> {
    if (!n || typeof n !== "object") return {};
    const a = (n as XNode)[ATTR_KEY];
    return (a as Record<string, string>) ?? {};
}

function makeEl(
    name: string,
    children: XNode[] = [],
    attrs?: Record<string, string>,
): XNode {
    const el: XNode = { [name]: children };
    if (attrs) {
        const attrObj: Record<string, string> = {};
        for (const [k, v] of Object.entries(attrs)) {
            attrObj[`@_${k}`] = v;
        }
        el[ATTR_KEY] = attrObj;
    }
    return el;
}

function makeText(s: string): XNode {
    return { [TEXT_KEY]: s };
}

function getTextContent(wtEl: XNode): string {
    // A w:t node has only a single text child (or nothing).
    const kids = elChildren(wtEl);
    let out = "";
    for (const k of kids) {
        if (isTextNode(k)) out += String(k[TEXT_KEY] ?? "");
    }
    return out;
}

// Build a w:r element that wraps a piece of text. Newlines in the text are
// emitted as <w:br/> soft line breaks (interleaved with w:t/w:delText
// segments) so models can request multi-line replacements without the
// literal "\n" showing up as visible text.
function buildRun(rPr: XNode | null, text: string, tagName: "w:t" | "w:delText"): XNode {
    const children: XNode[] = [];
    if (rPr) children.push(cloneNode(rPr));
    const segments = text.split("\n");
    for (let i = 0; i < segments.length; i++) {
        if (i > 0) children.push(makeEl("w:br", []));
        const seg = segments[i];
        if (seg.length > 0) {
            children.push(
                makeEl(tagName, [makeText(seg)], { "xml:space": "preserve" }),
            );
        }
    }
    return makeEl("w:r", children);
}

function cloneNode<T>(n: T): T {
    return JSON.parse(JSON.stringify(n)) as T;
}

// ---------------------------------------------------------------------------
// Paragraph flattening
// ---------------------------------------------------------------------------

/** Author metadata copied off a pre-existing w:ins so a later edit can keep it. */
interface ExistingInsertion {
    id: string;
    author: string;
    date: string;
}

interface RunSlot {
    childIndex: number;         // index in paragraph.children
    rPr: XNode | null;          // reference (not cloned)
    /** Set when this run was read from inside a w:ins. Shared by every run of that wrapper. */
    insertion: ExistingInsertion | null;
    /**
     * Per-w:t info. Slots preserve the relative order of the run's textual
     * children. Non-textual run children (w:tab, w:br, ...) are ignored for
     * the char stream but left in place via their surrounding w:r.
     */
    textNodes: { wtEl: XNode; text: string; paraStart: number; paraEnd: number }[];
}

interface Flattened {
    paraText: string;
    // For each char index in paraText: which run slot + which textNode + offset within text
    charRun: Int32Array;      // runIdx
    charTextNode: Int32Array; // index into slot.textNodes
    charOffset: Int32Array;   // offset within that textNode.text
    runs: RunSlot[];          // order corresponds to their paragraph position
}

function flattenParagraph(paraChildren: XNode[]): Flattened {
    const runs: RunSlot[] = [];
    let paraText = "";
    const charRunArr: number[] = [];
    const charTextNodeArr: number[] = [];
    const charOffsetArr: number[] = [];

    const processRun = (rEl: XNode, topChildIdx: number, insertion: ExistingInsertion | null) => {
        const rKids = elChildren(rEl);
        let rPr: XNode | null = null;
        const textNodes: RunSlot["textNodes"] = [];
        for (const rk of rKids) {
            const name = elName(rk);
            if (name === "w:rPr") {
                rPr = rk;
            } else if (name === "w:t") {
                const txt = getTextContent(rk);
                const start = paraText.length;
                textNodes.push({
                    wtEl: rk,
                    text: txt,
                    paraStart: start,
                    paraEnd: start + txt.length,
                });
                const runIdx = runs.length;
                const tnIdx = textNodes.length - 1;
                paraText += txt;
                for (let i = 0; i < txt.length; i++) {
                    charRunArr.push(runIdx);
                    charTextNodeArr.push(tnIdx);
                    charOffsetArr.push(i);
                }
            }
            // other run children (w:tab, w:br, w:sym, …) are left alone
        }
        runs.push({ childIndex: topChildIdx, rPr, textNodes, insertion });
    };

    for (let ci = 0; ci < paraChildren.length; ci++) {
        const child = paraChildren[ci];
        const name = elName(child);
        if (name === "w:r") {
            processRun(child, ci, null);
        } else if (name === "w:ins") {
            // Accepted view: include inner runs as if bare. childIndex points
            // at the w:ins wrapper so reconstruction can drop that wrapper
            // and re-emit it, still under the original author, around any
            // characters this edit does not itself change.
            const attrs = elAttrs(child);
            const insertion: ExistingInsertion = {
                id: attrs["@_w:id"] ?? "",
                author: attrs["@_w:author"] ?? "",
                date: attrs["@_w:date"] ?? "",
            };
            for (const inner of elChildren(child)) {
                if (elName(inner) === "w:r") processRun(inner, ci, insertion);
            }
        }
        // w:del: skip entirely — accepted view excludes deleted text.
    }

    return {
        paraText,
        charRun: Int32Array.from(charRunArr),
        charTextNode: Int32Array.from(charTextNodeArr),
        charOffset: Int32Array.from(charOffsetArr),
        runs,
    };
}

// ---------------------------------------------------------------------------
// Planning edits on a paragraph
// ---------------------------------------------------------------------------

/**
 * A single logical change. Spans a contiguous [start, end) character range in
 * the paragraph text (may be empty for a pure insert) and may carry an
 * inserted string appended at `start`.
 */
interface PlannedChange {
    editIndex: number;            // source edit index
    deleteStart: number;          // paragraph text offset (inclusive)
    deleteEnd: number;            // paragraph text offset (exclusive); may equal start
    deletedText: string;          // substring of paraText in [start, end)
    insertedText: string;         // may be empty
    contextBefore: string;
    contextAfter: string;
    reason?: string;
    changeId: string;             // logical id (not the w:id)
    delWId?: string;              // w:id of w:del wrapper (if deletedText non-empty)
    insWId?: string;              // w:id of w:ins wrapper (if insertedText non-empty)
}

/**
 * Collapse a find/replace pair into a minimal `{deletedText, insertedText}`
 * tuple anchored at a single start position. A character-level diff would
 * produce sequences like EQ-DEL-EQ-INS; for the tracked-change UI we want one
 * "replace this substring with that substring" card per edit, so only the
 * common prefix and suffix are trimmed and the rest is one span.
 */
function collapseDiff(find: string, replace: string): { deleted: string; inserted: string; leadingEq: number; trailingEq: number } {
    // Find leading/trailing common substrings so the tracked range is minimal
    let leading = 0;
    const minLen = Math.min(find.length, replace.length);
    while (leading < minLen && find[leading] === replace[leading]) leading++;
    let trailing = 0;
    while (
        trailing < minLen - leading &&
        find[find.length - 1 - trailing] === replace[replace.length - 1 - trailing]
    ) {
        trailing++;
    }
    const deleted = find.slice(leading, find.length - trailing);
    const inserted = replace.slice(leading, replace.length - trailing);
    return { deleted, inserted, leadingEq: leading, trailingEq: trailing };
}

// ---------------------------------------------------------------------------
// Paragraph reconstruction
// ---------------------------------------------------------------------------

/**
 * Given a paragraph's children and a sorted, non-overlapping list of
 * `PlannedChange`s that fall within it, return a new children array with
 * tracked changes inserted.
 */
function reconstructParagraph(
    paraChildren: XNode[],
    flat: Flattened,
    plan: PlannedChange[],
    now: string,
    author: string,
): XNode[] {
    if (plan.length === 0) return paraChildren;

    // Determine the run-index span that edits touch.
    let firstRunIdx = flat.runs.length;
    let lastRunIdx = -1;
    for (const p of plan) {
        for (let pos = p.deleteStart; pos < p.deleteEnd; pos++) {
            const r = flat.charRun[pos];
            if (r < firstRunIdx) firstRunIdx = r;
            if (r > lastRunIdx) lastRunIdx = r;
        }
        // Also include the run to the left/right of a pure insertion so we
        // can inherit its rPr.
        if (p.deleteStart === p.deleteEnd && p.deleteStart < flat.paraText.length) {
            const r = flat.charRun[p.deleteStart];
            if (r < firstRunIdx) firstRunIdx = r;
            if (r > lastRunIdx) lastRunIdx = r;
        } else if (p.deleteStart === p.deleteEnd && p.deleteStart > 0) {
            const r = flat.charRun[p.deleteStart - 1];
            if (r < firstRunIdx) firstRunIdx = r;
            if (r > lastRunIdx) lastRunIdx = r;
        }
    }
    if (firstRunIdx > lastRunIdx) {
        // No runs touched (edits against empty paragraph?) — nothing to do.
        return paraChildren;
    }

    // Child-index range in paragraph.children we are going to replace.
    const startChildIdx = flat.runs[firstRunIdx].childIndex;
    const endChildIdx = flat.runs[lastRunIdx].childIndex;

    // Paragraph-text range that this run span covers.
    const firstRun = flat.runs[firstRunIdx];
    const lastRun = flat.runs[lastRunIdx];
    const spanStart =
        firstRun.textNodes.length > 0 ? firstRun.textNodes[0].paraStart : 0;
    const spanEnd =
        lastRun.textNodes.length > 0
            ? lastRun.textNodes[lastRun.textNodes.length - 1].paraEnd
            : spanStart;

    // Walk [spanStart, spanEnd) in paraText, producing a new children array.
    const newRunGroup: XNode[] = [];

    // Helper: get the rPr for the run containing paragraph offset `pos`
    // (clamped to the touched span). Used to inherit formatting for
    // insertions that fall exactly on a boundary.
    const rPrForPos = (pos: number): XNode | null => {
        if (pos < 0) pos = 0;
        if (pos >= flat.paraText.length) pos = flat.paraText.length - 1;
        if (pos < 0) return firstRun.rPr;
        return flat.runs[flat.charRun[pos]].rPr;
    };

    // Emit [a, b) of paraText. Characters that already belonged to a tracked
    // insertion stay inside that insertion, under its original author, so a
    // new edit stacked on someone else's redline does not accept their
    // markup or turn an earlier note into plain body text.
    const emitNormal = (a: number, b: number) => {
        if (a >= b) return;
        let i = a;
        while (i < b) {
            const insertion = flat.runs[flat.charRun[i]].insertion;
            const fragments: XNode[] = [];
            let j = i;
            while (j < b && flat.runs[flat.charRun[j]].insertion === insertion) {
                const runIdx = flat.charRun[j];
                const tnIdx = flat.charTextNode[j];
                let k = j + 1;
                while (
                    k < b &&
                    flat.charRun[k] === runIdx &&
                    flat.charTextNode[k] === tnIdx
                ) {
                    k++;
                }
                const slot = flat.runs[runIdx];
                fragments.push(buildRun(slot.rPr, flat.paraText.slice(j, k), "w:t"));
                j = k;
            }
            if (insertion) {
                const attrs: Record<string, string> = {};
                if (insertion.id) attrs["w:id"] = insertion.id;
                if (insertion.author) attrs["w:author"] = insertion.author;
                if (insertion.date) attrs["w:date"] = insertion.date;
                newRunGroup.push(makeEl("w:ins", fragments, attrs));
            } else {
                for (const fragment of fragments) newRunGroup.push(fragment);
            }
            i = j;
        }
    };

    // Emit a w:del wrapping run fragments covering [a, b) of paraText.
    const emitDel = (a: number, b: number, wId: string) => {
        if (a >= b) return;
        const inner: XNode[] = [];
        let i = a;
        while (i < b) {
            const runIdx = flat.charRun[i];
            const tnIdx = flat.charTextNode[i];
            let j = i + 1;
            while (
                j < b &&
                flat.charRun[j] === runIdx &&
                flat.charTextNode[j] === tnIdx
            ) {
                j++;
            }
            const slot = flat.runs[runIdx];
            const slice = flat.paraText.slice(i, j);
            inner.push(buildRun(slot.rPr, slice, "w:delText"));
            i = j;
        }
        newRunGroup.push(
            makeEl("w:del", inner, {
                "w:id": wId,
                "w:author": author,
                "w:date": now,
            }),
        );
    };

    // Emit a w:ins at position `pos` inheriting rPr from there.
    const emitIns = (pos: number, text: string, wId: string) => {
        if (!text) return;
        const rPr = rPrForPos(pos === spanEnd ? pos - 1 : pos);
        const run = buildRun(rPr, text, "w:t");
        newRunGroup.push(
            makeEl("w:ins", [run], {
                "w:id": wId,
                "w:author": author,
                "w:date": now,
            }),
        );
    };

    let cursor = spanStart;
    for (const p of plan) {
        // Untouched slice before this edit
        emitNormal(cursor, p.deleteStart);
        // Insertion fires at the edit boundary
        if (p.insertedText) emitIns(p.deleteStart, p.insertedText, p.insWId!);
        // Deletion wraps the span
        if (p.deleteEnd > p.deleteStart)
            emitDel(p.deleteStart, p.deleteEnd, p.delWId!);
        cursor = p.deleteEnd;
    }
    emitNormal(cursor, spanEnd);

    // Replace only the w:r children that the edits touch; preserve any other
    // interleaved elements (bookmarks, existing tracked-changes, w:sdt …) at
    // their original positions.
    const droppedChildIdx = new Set<number>();
    for (let r = firstRunIdx; r <= lastRunIdx; r++) {
        droppedChildIdx.add(flat.runs[r].childIndex);
    }
    // Any w:del wrappers that sit inside the span we're rewriting are also
    // dropped, which accepts their deletions (their text is already absent
    // from paraText in the accepted view).
    for (let i = startChildIdx; i <= endChildIdx; i++) {
        if (elName(paraChildren[i]) === "w:del") droppedChildIdx.add(i);
    }
    const firstDroppedIdx = startChildIdx;
    void endChildIdx;
    const out: XNode[] = [];
    for (let i = 0; i < paraChildren.length; i++) {
        if (i === firstDroppedIdx) {
            for (const n of newRunGroup) out.push(n);
        }
        if (droppedChildIdx.has(i)) continue;
        out.push(paraChildren[i]);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Locating context in the document
// ---------------------------------------------------------------------------

interface ParagraphRef {
    paraNode: XNode;
    paraChildren: XNode[];
    flat: Flattened;
    globalStart: number; // where this paragraph starts in the full doc text
}

// --- Whitespace / punctuation normalization for anchor matching -------------
// The text LLMs see (via mammoth's extractRawText) does not line up 1:1 with
// the raw w:t concatenation: smart quotes, non-breaking spaces, tabs, and
// runs of whitespace all differ. We normalize both haystack and needle to
// a canonical form for matching, then map matched offsets back to the
// original paragraph text.

function preNormalize(s: string): string {
    // All 1-to-1 character replacements — preserves length for straightforward
    // index mapping.
    return s
        .replace(/[\u2018\u2019\u2032]/g, "'")
        .replace(/[\u201C\u201D\u2033]/g, '"')
        .replace(/[\u2013\u2014]/g, "-")
        .replace(/\u00A0/g, " ")
        .replace(/\u200B/g, " ");
}

interface Normalized {
    norm: string;
    // origIdx[i] = index in the *original* string for norm[i]
    origIdx: number[];
}

function normalizeWs(input: string): Normalized {
    const s = preNormalize(input);
    const norm: string[] = [];
    const origIdx: number[] = [];
    let prevSpace = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (/\s/.test(ch)) {
            if (!prevSpace) {
                norm.push(" ");
                origIdx.push(i);
                prevSpace = true;
            }
        } else {
            norm.push(ch);
            origIdx.push(i);
            prevSpace = false;
        }
    }
    return { norm: norm.join(""), origIdx };
}

/**
 * Locate the unique position in `hayNorm` where `findNorm` appears AND is
 * preceded by `ctxBeforeNorm` AND followed by `ctxAfterNorm`. The context
 * check uses direct string-slice equality rather than concatenation so
 * boundary-whitespace collapsing doesn't matter. Returns the normalized
 * [start, end) range of the `find` portion, or a structured error.
 */
function findUniqueAnchor(
    hayNorm: string,
    findNorm: string,
    ctxBeforeNorm: string,
    ctxAfterNorm: string,
): { start: number; end: number } | { error: "none" | "ambiguous" } {
    const candidates: number[] = [];

    const checkCtx = (pos: number): boolean => {
        if (ctxBeforeNorm) {
            const start = pos - ctxBeforeNorm.length;
            if (start < 0) return false;
            if (hayNorm.slice(start, pos) !== ctxBeforeNorm) return false;
        }
        if (ctxAfterNorm) {
            const end = pos + findNorm.length;
            if (hayNorm.slice(end, end + ctxAfterNorm.length) !== ctxAfterNorm)
                return false;
        }
        return true;
    };

    if (findNorm.length === 0) {
        // Pure insertion — scan every position
        for (let i = 0; i <= hayNorm.length; i++) {
            if (checkCtx(i)) candidates.push(i);
        }
    } else {
        let from = 0;
        while (from <= hayNorm.length - findNorm.length) {
            const idx = hayNorm.indexOf(findNorm, from);
            if (idx < 0) break;
            if (checkCtx(idx)) candidates.push(idx);
            from = idx + 1;
        }
    }

    if (candidates.length === 0) return { error: "none" };
    if (candidates.length > 1) return { error: "ambiguous" };
    return {
        start: candidates[0],
        end: candidates[0] + findNorm.length,
    };
}

/** Map a normalized [start, end) range back to the original string range. */
function mapNormRangeToOriginal(
    paraNorm: Normalized,
    origLen: number,
    normStart: number,
    normEnd: number,
): { start: number; end: number } {
    const origStart =
        normStart < paraNorm.origIdx.length
            ? paraNorm.origIdx[normStart]
            : origLen;
    const origEnd =
        normEnd === normStart
            ? origStart
            : normEnd - 1 < paraNorm.origIdx.length
              ? paraNorm.origIdx[normEnd - 1] + 1
              : origLen;
    return { start: origStart, end: origEnd };
}

// ---------------------------------------------------------------------------
// Main: applyTrackedEdits
// ---------------------------------------------------------------------------

function createParser() {
    return new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        preserveOrder: true,
        trimValues: false,
        parseTagValue: false,
        parseAttributeValue: false,
        processEntities: true,
    });
}

function createBuilder() {
    return new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        preserveOrder: true,
        suppressEmptyNode: false,
        processEntities: true,
    });
}

function findBody(doc: XNode[]): XNode[] | null {
    for (const top of doc) {
        if (elName(top) === "w:document") {
            for (const c of elChildren(top)) {
                if (elName(c) === "w:body") return elChildren(c);
            }
        }
    }
    return null;
}

function replaceBody(doc: XNode[], bodyChildren: XNode[]): void {
    for (const top of doc) {
        if (elName(top) !== "w:document") continue;
        const docKids = elChildren(top);
        for (const c of docKids) {
            if (elName(c) === "w:body") setChildren(c, bodyChildren);
        }
    }
}

/**
 * Walk a tree and collect all max w:id values in w:ins/w:del so new changes
 * can start their numbering safely above it.
 */
function maxTrackedId(doc: XNode[]): number {
    let max = 0;
    const visit = (n: unknown) => {
        const name = elName(n);
        if (!name) return;
        if (name === "w:ins" || name === "w:del") {
            const a = elAttrs(n);
            const raw = a["@_w:id"];
            if (raw != null) {
                const v = parseInt(String(raw), 10);
                if (Number.isFinite(v) && v > max) max = v;
            }
        }
        for (const c of elChildren(n as XNode)) visit(c);
    };
    for (const top of doc) visit(top);
    return max;
}

/**
 * Extract the body text of a .docx using the same flattening rules as the
 * tracked-changes matcher. Paragraphs are joined by a single newline. The
 * output is what the LLM should base its `find` / `context_before` /
 * `context_after` strings on, since it exactly mirrors the string the
 * anchor matcher operates against.
 */
export async function extractDocxBodyText(bytes: Buffer): Promise<string> {
    const zip = await JSZip.loadAsync(bytes);
    const docXmlFile = getZipEntry(zip, "word/document.xml");
    if (!docXmlFile) return "";
    const docXmlRaw = await docXmlFile.async("string");
    const parser = createParser();
    const tree = parser.parse(docXmlRaw) as XNode[];
    const bodyChildren = findBody(tree);
    if (!bodyChildren) return "";

    const lines: string[] = [];
    const collect = (nodes: XNode[]) => {
        for (const n of nodes) {
            const name = elName(n);
            if (!name) continue;
            if (name === "w:p") {
                const flat = flattenParagraph(elChildren(n));
                lines.push(flat.paraText);
            } else if (
                name === "w:tbl" ||
                name === "w:tr" ||
                name === "w:tc" ||
                name === "w:sdt" ||
                name === "w:sdtContent"
            ) {
                collect(elChildren(n));
            }
        }
    };
    collect(bodyChildren);
    return lines.join("\n");
}

/**
 * Walk document.xml in render order and collect the w:id for every
 * w:ins / w:del wrapper. The order here matches what docx-preview emits
 * as <ins>/<del> in the DOM, so the frontend can tag each rendered
 * element by index to recover the w:id attribute that docx-preview drops.
 */
export async function extractTrackedChangeIds(
    bytes: Buffer,
): Promise<{ kind: "ins" | "del"; w_id: string }[]> {
    const zip = await JSZip.loadAsync(bytes);
    const docXmlFile = getZipEntry(zip, "word/document.xml");
    if (!docXmlFile) return [];
    const docXmlRaw = await docXmlFile.async("string");
    const parser = createParser();
    const tree = parser.parse(docXmlRaw) as XNode[];
    const out: { kind: "ins" | "del"; w_id: string }[] = [];
    const visit = (n: unknown) => {
        const name = elName(n);
        if (!name) return;
        if (name === "w:ins" || name === "w:del") {
            const a = elAttrs(n);
            const raw = a["@_w:id"];
            if (raw != null) {
                out.push({
                    kind: name === "w:ins" ? "ins" : "del",
                    w_id: String(raw),
                });
            }
        }
        for (const c of elChildren(n as XNode)) visit(c);
    };
    for (const top of tree) visit(top);
    return out;
}

// ---------------------------------------------------------------------------
// Tracked-change inventory and accept-all
// ---------------------------------------------------------------------------

export interface TrackedChangeSummary {
    w_id: string;
    kind: "ins" | "del";
    author: string | null;
    date: string | null;
    /** Text inside the wrapper (inserted text, or the deleted text). */
    text: string;
}

/** One Word review comment, including replies. */
export interface DocxCommentRecord {
    id: string;
    author: string | null;
    date: string | null;
    initials: string | null;
    /** The comment bubble's own text. */
    text: string;
    /** Passage the bubble is anchored to. Null for a reply with no range of its own. */
    anchor: string | null;
    /** Parent comment id when this bubble is a reply. */
    parentId: string | null;
    resolved: boolean;
}

export interface TrackedMarkupSummary {
    /** Insertions and deletions in reading order, document body first. */
    changes: TrackedChangeSummary[];
    /** Formatting/property change records (w:rPrChange, w:pPrChange, ...). */
    propertyChanges: number;
    /** Tracked moves (w:moveFrom / w:moveTo wrappers). */
    moves: number;
    /** Comment anchors in the body. */
    comments: number;
    /** Review-comment bubbles, thread order (a reply follows its parent). */
    commentRecords: DocxCommentRecord[];
}

/** Text of every w:t / w:delText below a node, in order. */
function collectRunText(n: XNode): string {
    let out = "";
    const visit = (node: XNode) => {
        const name = elName(node);
        if (!name) return;
        if (name === "w:t" || name === "w:delText") {
            out += getTextContent(node);
            return;
        }
        if (name === "w:tab") out += "\t";
        if (name === "w:br") out += "\n";
        for (const c of elChildren(node)) visit(c);
    };
    visit(n);
    return out;
}

const PROPERTY_CHANGE_TAGS = new Set([
    "w:rPrChange",
    "w:pPrChange",
    "w:sectPrChange",
    "w:tblPrChange",
    "w:tblPrExChange",
    "w:trPrChange",
    "w:tcPrChange",
    "w:tblGridChange",
    "w:numberingChange",
]);

const MOVE_RANGE_TAGS = new Set([
    "w:moveFromRangeStart",
    "w:moveFromRangeEnd",
    "w:moveToRangeStart",
    "w:moveToRangeEnd",
]);

/** Story parts that can carry tracked changes. */
const STORY_PART_PATTERN =
    /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

function storyPartNames(zip: JSZip): string[] {
    return Object.keys(zip.files)
        .map((name) => name.replace(/\\/g, "/"))
        .filter((name) => STORY_PART_PATTERN.test(name))
        .sort((a, b) =>
            a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b),
        );
}

/**
 * What is still marked up in the file: every pending insertion and deletion
 * with its author, plus counts of the markup kinds the body text cannot
 * show. Lets a reader tell existing redline from body text before deciding
 * what "the latest round of changes" means.
 */
export async function listTrackedChanges(
    bytes: Buffer,
): Promise<TrackedMarkupSummary> {
    const zip = await JSZip.loadAsync(bytes);
    const summary: TrackedMarkupSummary = {
        changes: [],
        propertyChanges: 0,
        moves: 0,
        comments: 0,
        commentRecords: [],
    };
    const parser = createParser();
    const anchors = new Map<string, string>();
    for (const partName of storyPartNames(zip)) {
        const file = getZipEntry(zip, partName);
        if (!file) continue;
        const tree = parser.parse(await file.async("string")) as XNode[];
        const open = new Map<string, string>();
        const visit = (n: unknown, inRunProps: boolean) => {
            const name = elName(n);
            if (!name) return;
            if ((name === "w:ins" || name === "w:del") && !inRunProps) {
                const a = elAttrs(n);
                summary.changes.push({
                    w_id: String(a["@_w:id"] ?? ""),
                    kind: name === "w:ins" ? "ins" : "del",
                    author: a["@_w:author"] != null ? String(a["@_w:author"]) : null,
                    date: a["@_w:date"] != null ? String(a["@_w:date"]) : null,
                    text: collectRunText(n as XNode),
                });
            } else if (PROPERTY_CHANGE_TAGS.has(name)) {
                summary.propertyChanges += 1;
            } else if (name === "w:moveFrom" || name === "w:moveTo") {
                summary.moves += 1;
            } else if (name === "w:commentRangeStart") {
                summary.comments += 1;
                const id = String(elAttrs(n)["@_w:id"] ?? "");
                if (id) open.set(id, "");
            } else if (name === "w:commentRangeEnd") {
                const id = String(elAttrs(n)["@_w:id"] ?? "");
                const text = open.get(id);
                if (id && text !== undefined && !anchors.has(id)) {
                    anchors.set(id, text.replace(/\s+/g, " ").trim());
                }
                open.delete(id);
            } else if (
                (name === "w:t" || name === "w:delText") &&
                open.size > 0
            ) {
                const bit = getTextContent(n as XNode);
                if (bit) {
                    for (const [id, soFar] of open) open.set(id, soFar + bit);
                }
            }
            const nextInRunProps = inRunProps || name === "w:rPr";
            for (const c of elChildren(n as XNode)) visit(c, nextInRunProps);
        };
        for (const top of tree) visit(top, false);
    }
    summary.commentRecords = await readCommentRecords(zip, parser, anchors);
    return summary;
}

const COMMENTS_REL_TYPE =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const COMMENTS_CONTENT_TYPE =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
const COMMENTS_EX_REL_TYPE =
    "http://schemas.microsoft.com/office/2011/relationships/commentsExtended";
const COMMENTS_EX_CONTENT_TYPE =
    "application/vnd.FAKESECRET_e2f3g4h5i6j7k8l9m0n1+xml";

function attrOf(node: XNode, ...keys: string[]): string | null {
    const attrs = elAttrs(node);
    for (const key of keys) {
        const value = attrs[key];
        if (value != null && String(value) !== "") return String(value);
    }
    return null;
}

function commentBodyText(comment: XNode): string {
    const lines: string[] = [];
    const visit = (n: XNode) => {
        const name = elName(n);
        if (!name) return;
        if (name === "w:p") {
            lines.push(collectRunText(n).replace(/\s+/g, " ").trim());
            return;
        }
        for (const c of elChildren(n)) visit(c);
    };
    for (const c of elChildren(comment)) visit(c);
    return lines.filter(Boolean).join("\n");
}

function firstParagraphParaId(comment: XNode): string | null {
    for (const c of elChildren(comment)) {
        if (elName(c) !== "w:p") continue;
        return attrOf(c, "@_w14:paraId", "@_w:paraId");
    }
    return null;
}

/**
 * Read word/comments.xml (and commentsExtended.xml for replies and resolved
 * state) into records the model can act on. Anchors come from the story
 * parts' comment ranges.
 */
async function readCommentRecords(
    zip: JSZip,
    parser: XMLParser,
    anchors: Map<string, string>,
): Promise<DocxCommentRecord[]> {
    const file = getZipEntry(zip, "word/comments.xml");
    if (!file) return [];
    const tree = parser.parse(await file.async("string")) as XNode[];
    const commentsRoot = tree.find((n) => elName(n) === "w:comments");
    if (!commentsRoot) return [];

    const paraIdToCommentId = new Map<string, string>();
    const drafts: {
        id: string;
        author: string | null;
        date: string | null;
        initials: string | null;
        text: string;
        anchor: string | null;
        paraId: string | null;
    }[] = [];
    for (const node of elChildren(commentsRoot)) {
        if (elName(node) !== "w:comment") continue;
        const id = attrOf(node, "@_w:id");
        if (!id) continue;
        const paraId = firstParagraphParaId(node);
        if (paraId) paraIdToCommentId.set(paraId.toUpperCase(), id);
        drafts.push({
            id,
            author: attrOf(node, "@_w:author"),
            date: attrOf(node, "@_w:date"),
            initials: attrOf(node, "@_w:initials"),
            text: commentBodyText(node),
            anchor: anchors.get(id) ?? null,
            paraId,
        });
    }

    const parentByPara = new Map<string, string>();
    const doneParas = new Set<string>();
    const extended = getZipEntry(zip, "word/commentsExtended.xml");
    if (extended) {
        const exTree = parser.parse(await extended.async("string")) as XNode[];
        const visitEx = (n: XNode) => {
            const name = elName(n);
            if (!name) return;
            if (name === "w15:commentEx" || name.endsWith(":commentEx")) {
                const paraId = attrOf(n, "@_w15:paraId", "@_w:paraId");
                const parent = attrOf(n, "@_w15:paraIdParent", "@_w:paraIdParent");
                const done = attrOf(n, "@_w15:done", "@_w:done");
                if (paraId && parent) parentByPara.set(paraId.toUpperCase(), parent.toUpperCase());
                if (paraId && done === "1") doneParas.add(paraId.toUpperCase());
            }
            for (const c of elChildren(n)) visitEx(c);
        };
        for (const top of exTree) visitEx(top);
    }

    const records: DocxCommentRecord[] = drafts.map((draft) => {
        const key = draft.paraId?.toUpperCase() ?? "";
        const parentPara = key ? parentByPara.get(key) : undefined;
        return {
            id: draft.id,
            author: draft.author,
            date: draft.date,
            initials: draft.initials,
            text: draft.text,
            anchor: draft.anchor,
            parentId: parentPara ? (paraIdToCommentId.get(parentPara) ?? null) : null,
            resolved: key ? doneParas.has(key) : false,
        };
    });

    const byId = new Map(records.map((r) => [r.id, r]));
    const threaded: DocxCommentRecord[] = [];
    const placed = new Set<string>();
    const place = (record: DocxCommentRecord) => {
        if (placed.has(record.id)) return;
        if (record.parentId && byId.has(record.parentId)) {
            place(byId.get(record.parentId)!);
        }
        placed.add(record.id);
        threaded.push(record);
    };
    for (const record of records) place(record);
    return threaded;
}

export interface AcceptAllResult {
    bytes: Buffer;
    /** Insertions, deletions and moves collapsed. */
    accepted: number;
    propertyChangesAccepted: number;
    commentsRemoved: number;
}

/**
 * Accept every tracked change and strip comments so the file reads as an
 * execution copy: insertions and moved-to text become body text, deletions
 * and moved-from text disappear, formatting change records are dropped, and
 * comment anchors plus the comments parts are removed from the package.
 *
 * A deleted paragraph mark (w:del inside the paragraph's w:rPr) is accepted
 * by joining the paragraph with the one that follows it.
 */
export async function acceptAllTrackedChanges(
    bytes: Buffer,
): Promise<AcceptAllResult> {
    const zip = await JSZip.loadAsync(bytes);
    const parser = createParser();
    const builder = createBuilder();
    const result: AcceptAllResult = {
        bytes,
        accepted: 0,
        propertyChangesAccepted: 0,
        commentsRemoved: 0,
    };

    const rewrite = (kids: XNode[], parentName: string | null): XNode[] => {
        const out: XNode[] = [];
        const inRunProps = parentName === "w:rPr";
        for (const n of kids) {
            const name = elName(n);
            if (!name) {
                out.push(n);
                continue;
            }
            if (inRunProps && name === "w:ins") {
                // An inserted paragraph mark or run: accepting it is dropping
                // the marker.
                result.accepted += 1;
                continue;
            }
            if (inRunProps && name === "w:del") {
                // A deleted paragraph mark is accepted by joining paragraphs
                // afterwards, so the marker stays for that pass.
                out.push(n);
                continue;
            }
            if (name === "w:del" || name === "w:moveFrom") {
                result.accepted += 1;
                continue;
            }
            if (name === "w:ins" || name === "w:moveTo") {
                result.accepted += 1;
                out.push(...rewrite(elChildren(n), parentName));
                continue;
            }
            if (MOVE_RANGE_TAGS.has(name)) continue;
            if (PROPERTY_CHANGE_TAGS.has(name)) {
                result.propertyChangesAccepted += 1;
                continue;
            }
            if (name === "w:commentRangeStart" || name === "w:commentRangeEnd") {
                if (name === "w:commentRangeStart") result.commentsRemoved += 1;
                continue;
            }
            if (name === "w:r") {
                const runKids = elChildren(n);
                if (runKids.some((k) => elName(k) === "w:commentReference")) {
                    const kept = runKids.filter(
                        (k) => elName(k) !== "w:commentReference",
                    );
                    if (kept.every((k) => elName(k) === "w:rPr")) continue;
                    setChildren(n, rewrite(kept, name));
                    out.push(n);
                    continue;
                }
            }
            const children = elChildren(n);
            if (children.length) setChildren(n, rewrite(children, name));
            out.push(n);
        }
        return out;
    };

    const paragraphMarkRunProps = (p: XNode): XNode | undefined => {
        const pPr = elChildren(p).find((k) => elName(k) === "w:pPr");
        return pPr
            ? elChildren(pPr).find((k) => elName(k) === "w:rPr")
            : undefined;
    };

    /** w:del on a paragraph mark: fold the following paragraph into it. */
    const joinDeletedParagraphMarks = (kids: XNode[]): XNode[] => {
        const merged: XNode[] = [];
        for (let i = 0; i < kids.length; i += 1) {
            const n = kids[i];
            const name = elName(n);
            if (name !== "w:p") {
                const children = elChildren(n);
                if (name && children.length) {
                    setChildren(n, joinDeletedParagraphMarks(children));
                }
                merged.push(n);
                continue;
            }
            for (;;) {
                const rPr = paragraphMarkRunProps(n);
                const markDeleted =
                    !!rPr && elChildren(rPr).some((k) => elName(k) === "w:del");
                if (!markDeleted || !rPr) break;
                result.accepted += 1;
                setChildren(
                    rPr,
                    elChildren(rPr).filter((k) => elName(k) !== "w:del"),
                );
                const next = kids[i + 1];
                if (!next || elName(next) !== "w:p") break;
                const body = elChildren(next).filter((k) => elName(k) !== "w:pPr");
                setChildren(n, [...elChildren(n), ...body]);
                i += 1;
                // The joined paragraph may itself carry a deleted mark.
                const nextRPr = paragraphMarkRunProps(next);
                if (
                    nextRPr &&
                    elChildren(nextRPr).some((k) => elName(k) === "w:del") &&
                    rPr
                ) {
                    setChildren(rPr, [...elChildren(rPr), makeEl("w:del", [])]);
                }
            }
            merged.push(n);
        }
        return merged;
    };

    for (const partName of storyPartNames(zip)) {
        const file = getZipEntry(zip, partName);
        if (!file) continue;
        const tree = parser.parse(await file.async("string")) as XNode[];
        for (const top of tree) {
            const name = elName(top);
            const children = elChildren(top);
            if (!name || !children.length) continue;
            setChildren(top, joinDeletedParagraphMarks(rewrite(children, name)));
        }
        setZipEntry(zip, partName, ensureXmlDeclaration(builder.build(tree)));
    }

    // Drop the comments parts and their wiring so nothing dangles.
    const commentParts = Object.keys(zip.files).filter((name) =>
        /^word\/comments(Extended|Ids|Extensible)?\.xml$/.test(
            name.replace(/\\/g, "/"),
        ),
    );
    for (const part of commentParts) zip.remove(part);
    const rels = getZipEntry(zip, "word/_rels/document.xml.rels");
    if (rels && commentParts.length) {
        const relsXml = await rels.async("string");
        setZipEntry(
            zip,
            "word/_rels/document.xml.rels",
            relsXml.replace(
                /<Relationship\b[^>]*Type="[^"]*\/comments(Extended|Ids|Extensible)?"[^>]*\/>/g,
                "",
            ),
        );
    }
    const contentTypes = getZipEntry(zip, "[Content_Types].xml");
    if (contentTypes && commentParts.length) {
        const xml = await contentTypes.async("string");
        setZipEntry(
            zip,
            "[Content_Types].xml",
            xml.replace(
                /<Override\b[^>]*PartName="\/word\/comments(Extended|Ids|Extensible)?\.xml"[^>]*\/>/g,
                "",
            ),
        );
    }

    result.bytes = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
    });
    return result;
}

export async function applyTrackedEdits(
    bytes: Buffer,
    edits: EditInput[],
    opts?: { author?: string },
): Promise<ApplyTrackedEditsResult> {
    const author = opts?.author ?? "Mike";
    const now = new Date().toISOString();

    const zip = await JSZip.loadAsync(bytes);
    const docXmlFile = getZipEntry(zip, "word/document.xml");
    if (!docXmlFile) throw new Error("document.xml missing from docx");
    const docXmlRaw = await docXmlFile.async("string");

    const parser = createParser();
    const tree = parser.parse(docXmlRaw) as XNode[];

    const bodyChildren = findBody(tree);
    if (!bodyChildren) throw new Error("w:body missing from document.xml");

    // Build paragraph table (only w:p at the top level of the body — does not
    // recurse into tables; for tables, w:p also appears inside w:tbl > w:tr >
    // w:tc so we need to traverse deeper).
    const paragraphs: ParagraphRef[] = [];
    const collectParagraphs = (nodes: XNode[]) => {
        for (const n of nodes) {
            const name = elName(n);
            if (!name) continue;
            if (name === "w:p") {
                const kids = elChildren(n);
                const flat = flattenParagraph(kids);
                paragraphs.push({
                    paraNode: n,
                    paraChildren: kids,
                    flat,
                    globalStart: 0, // set below
                });
            } else if (name === "w:tbl" || name === "w:tr" || name === "w:tc" || name === "w:sdt" || name === "w:sdtContent") {
                collectParagraphs(elChildren(n));
            }
        }
    };
    collectParagraphs(bodyChildren);

    // Assign global offsets (paragraphs joined by "\n" so context can
    // straddle a paragraph boundary, though edits themselves must stay
    // inside a single paragraph).
    {
        let off = 0;
        for (const p of paragraphs) {
            p.globalStart = off;
            off += p.flat.paraText.length + 1; // +1 for synthetic separator
        }
    }

    // Precompute normalized forms per paragraph for reuse across edits.
    const paraNorms: Normalized[] = paragraphs.map((p) =>
        normalizeWs(p.flat.paraText),
    );

    let nextWId = maxTrackedId(tree) + 1;
    const plansPerParagraph = new Map<number, PlannedChange[]>();
    const appliedChanges: AppliedChange[] = [];
    const errors: EditError[] = [];

    for (let editIdx = 0; editIdx < edits.length; editIdx++) {
        const edit = edits[editIdx];
        const find = edit.find ?? "";
        const replace = edit.replace ?? "";
        const ctxBefore = edit.context_before ?? "";
        const ctxAfter = edit.context_after ?? "";

        if (!find && !replace) {
            errors.push({ index: editIdx, reason: "Empty edit." });
            continue;
        }
        if (!find && !ctxBefore && !ctxAfter) {
            errors.push({
                index: editIdx,
                reason: "Pure insertion requires context_before or context_after.",
            });
            continue;
        }

        const findNorm = normalizeWs(find).norm;
        const ctxBeforeNorm = normalizeWs(ctxBefore).norm;
        const ctxAfterNorm = normalizeWs(ctxAfter).norm;

        // Strategy:
        //   1) find + full context  (strictest — preferred)
        //   2) find + half context  (drop whichever context side is shorter)
        //   3) find alone           (only if globally unique across doc)
        // At each stage we scan every paragraph. "Unique across the doc"
        // means exactly one paragraph yields exactly one match.
        type Hit = { paraIdx: number; normStart: number; normEnd: number };

        /**
         * Search every paragraph with the given context sides. If any
         * paragraph returns a match AND no paragraph is internally ambiguous,
         * return the collected hits; otherwise signal ambiguous.
         */
        const tryStrategy = (
            cb: string,
            ca: string,
        ): { kind: "ok"; hits: Hit[] } | { kind: "ambiguous" } => {
            const hits: Hit[] = [];
            let ambiguous = false;
            for (let pi = 0; pi < paragraphs.length; pi++) {
                const r = findUniqueAnchor(
                    paraNorms[pi].norm,
                    findNorm,
                    cb,
                    ca,
                );
                if ("error" in r) {
                    if (r.error === "ambiguous") ambiguous = true;
                    continue;
                }
                hits.push({ paraIdx: pi, normStart: r.start, normEnd: r.end });
            }
            if (ambiguous || hits.length > 1) return { kind: "ambiguous" };
            return { kind: "ok", hits };
        };

        let selected: Hit | null = null;
        const attempts = [
            { cb: ctxBeforeNorm, ca: ctxAfterNorm },
            { cb: ctxBeforeNorm, ca: "" },
            { cb: "", ca: ctxAfterNorm },
            { cb: "", ca: "" }, // find-only
        ];
        let sawAmbiguous = false;
        for (const { cb, ca } of attempts) {
            const r = tryStrategy(cb, ca);
            if (r.kind === "ambiguous") {
                sawAmbiguous = true;
                continue;
            }
            if (r.hits.length === 1) {
                selected = r.hits[0];
                break;
            }
        }

        if (!selected) {
            errors.push({
                index: editIdx,
                reason: sawAmbiguous
                    ? `Ambiguous match for find="${truncate(find, 80)}". Add longer context_before / context_after so the anchor is unique.`
                    : `Could not locate find="${truncate(find, 80)}" in the document. Re-read the document and copy context verbatim (including punctuation & whitespace).`,
            });
            continue;
        }

        const hit = selected;
        const paraIdx = hit.paraIdx;
        const paraNorm = paraNorms[paraIdx];
        const origLen = paragraphs[paraIdx].flat.paraText.length;
        const { start: findStart, end: findEnd } = mapNormRangeToOriginal(
            paraNorm,
            origLen,
            hit.normStart,
            hit.normEnd,
        );

        // Use the actual original text in that range as `deletedText` —
        // this preserves the document's whitespace/quote style rather than
        // the normalized needle the LLM provided.
        const originalFind = paragraphs[paraIdx].flat.paraText.slice(
            findStart,
            findEnd,
        );

        const { deleted, inserted, leadingEq } = collapseDiff(
            originalFind,
            replace,
        );
        const minStart = findStart + leadingEq;
        const minEnd = minStart + deleted.length;
        void findEnd;

        const changeId = `mike-${editIdx}-${Date.now()}`;
        const plan: PlannedChange = {
            editIndex: editIdx,
            deleteStart: minStart,
            deleteEnd: minEnd,
            deletedText: deleted,
            insertedText: inserted,
            contextBefore: edit.context_before ?? "",
            contextAfter: edit.context_after ?? "",
            reason: edit.reason,
            changeId,
            delWId: deleted ? String(nextWId++) : undefined,
            insWId: inserted ? String(nextWId++) : undefined,
        };

        // Check for overlap with earlier plans in the same paragraph.
        const existing = plansPerParagraph.get(paraIdx) ?? [];
        const overlap = existing.some(
            (p) => !(plan.deleteEnd <= p.deleteStart || plan.deleteStart >= p.deleteEnd),
        );
        if (overlap) {
            errors.push({
                index: editIdx,
                reason: "Overlaps a previous edit in the same paragraph.",
            });
            continue;
        }

        existing.push(plan);
        existing.sort((a, b) => a.deleteStart - b.deleteStart);
        plansPerParagraph.set(paraIdx, existing);

        appliedChanges.push({
            id: changeId,
            delId: plan.delWId,
            insId: plan.insWId,
            deletedText: plan.deletedText,
            insertedText: plan.insertedText,
            contextBefore: plan.contextBefore,
            contextAfter: plan.contextAfter,
            reason: plan.reason,
        });
    }

    // Apply plans per paragraph.
    for (const [paraIdx, plan] of plansPerParagraph) {
        const p = paragraphs[paraIdx];
        const newKids = reconstructParagraph(
            p.paraChildren,
            p.flat,
            plan,
            now,
            author,
        );
        setChildren(p.paraNode, newKids);
    }

    const builder = createBuilder();
    const rebuiltXml = builder.build(tree);
    const withDecl = ensureXmlDeclaration(rebuiltXml);
    setZipEntry(zip, "word/document.xml", withDecl);

    const outBuf = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
    });
    return { bytes: outBuf, changes: appliedChanges, errors };
}

// ---------------------------------------------------------------------------
// Resolve a single tracked change (Accept or Reject)
// ---------------------------------------------------------------------------

/**
 * Walk the XML tree and transform matching w:ins/w:del wrappers for the
 * given change id. Returns { found, updatedTree }.
 */
function resolveInTree(
    doc: XNode[],
    changeIds: string[],
    mode: "accept" | "reject",
): { found: boolean } {
    const ids = new Set(changeIds.map((s) => String(s)));
    let touched = false;

    const rewrite = (parentKids: XNode[]): XNode[] => {
        const out: XNode[] = [];
        for (const n of parentKids) {
            const name = elName(n);
            if (!name) {
                out.push(n);
                continue;
            }

            // Recurse first so nested tables/sdts get processed
            const kids = elChildren(n);
            if (kids.length) {
                const newKids = rewrite(kids);
                if (newKids !== kids) setChildren(n, newKids);
            }

            if (name === "w:ins" || name === "w:del") {
                const a = elAttrs(n);
                const wId = String(a["@_w:id"] ?? "");
                if (ids.has(wId)) {
                    touched = true;
                    if (
                        (name === "w:ins" && mode === "accept") ||
                        (name === "w:del" && mode === "reject")
                    ) {
                        // Keep children, drop wrapper. For w:del rejected, we
                        // also need to convert inner w:delText → w:t so the
                        // text reverts to normal body content.
                        const inner =
                            name === "w:del"
                                ? (elChildren(n) as XNode[]).map(unwrapDelText)
                                : (elChildren(n) as XNode[]);
                        for (const c of inner) out.push(c);
                        continue;
                    } else {
                        // accept-del / reject-ins → drop the wrapper and its
                        // inner runs entirely.
                        continue;
                    }
                }
            }

            out.push(n);
        }
        return out;
    };

    for (const top of doc) {
        if (elName(top) !== "w:document") continue;
        const docKids = elChildren(top);
        setChildren(top, rewrite(docKids));
    }

    return { found: touched };
}

function unwrapDelText(n: XNode): XNode {
    const name = elName(n);
    if (!name) return n;
    if (name === "w:r") {
        const kids = elChildren(n).map(unwrapDelText);
        setChildren(n, kids);
        return n;
    }
    if (name === "w:delText") {
        const attrs = elAttrs(n);
        return {
            "w:t": elChildren(n),
            ...(Object.keys(attrs).length ? { [ATTR_KEY]: attrs } : {}),
        };
    }
    return n;
}

export async function resolveTrackedChange(
    bytes: Buffer,
    changeIds: string[],
    mode: "accept" | "reject",
): Promise<{ bytes: Buffer; found: boolean }> {
    const zip = await JSZip.loadAsync(bytes);
    const docXmlFile = getZipEntry(zip, "word/document.xml");
    if (!docXmlFile) throw new Error("document.xml missing from docx");
    const docXmlRaw = await docXmlFile.async("string");

    const parser = createParser();
    const tree = parser.parse(docXmlRaw) as XNode[];

    const { found } = resolveInTree(tree, changeIds, mode);

    const builder = createBuilder();
    const rebuilt = ensureXmlDeclaration(builder.build(tree));
    setZipEntry(zip, "word/document.xml", rebuilt);
    const out = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
    });
    return { bytes: out, found };
}

// ---------------------------------------------------------------------------
// Review comments (read above; write here)
// ---------------------------------------------------------------------------

export interface CommentInput {
    /** Exact passage the bubble should sit on. One paragraph, non-empty. */
    anchor: string;
    context_before?: string;
    context_after?: string;
    /** Bubble text. */
    text: string;
    /**
     * Existing comment id to reply to. A reply is threaded in Word and does
     * not add a second range on the passage.
     */
    parent_id?: string;
}

export interface AppliedComment {
    id: string;
    anchor: string;
    text: string;
    parentId: string | null;
}

export interface ApplyDocxCommentsResult {
    bytes: Buffer;
    comments: AppliedComment[];
    errors: EditError[];
}

interface TextPiece {
    parent: XNode;
    runIndex: number;
    text: string;
    start: number;
    end: number;
}

function runVisibleText(run: XNode): string {
    let text = "";
    for (const child of elChildren(run)) {
        if (elName(child) === "w:t") text += getTextContent(child);
    }
    return text;
}

/** Accepted-view text pieces: bare runs and runs inside w:ins. w:del is skipped. */
function collectTextPieces(parent: XNode, cursor: { n: number }, out: TextPiece[]): void {
    const kids = elChildren(parent);
    for (let i = 0; i < kids.length; i += 1) {
        const name = elName(kids[i]);
        if (name === "w:r") {
            const text = runVisibleText(kids[i]);
            if (!text) continue;
            out.push({
                parent,
                runIndex: i,
                text,
                start: cursor.n,
                end: cursor.n + text.length,
            });
            cursor.n += text.length;
        } else if (name === "w:ins") {
            collectTextPieces(kids[i], cursor, out);
        }
    }
}

function runProps(run: XNode): XNode | null {
    return elChildren(run).find((child) => elName(child) === "w:rPr") ?? null;
}

function commentReferenceRun(id: string): XNode {
    return makeEl("w:r", [
        makeEl("w:rPr", [makeEl("w:rStyle", [], { "w:val": "CommentReference" })]),
        makeEl("w:commentReference", [], { "w:id": id }),
    ]);
}

function spliceChildren(parent: XNode, index: number, remove: number, insert: XNode[]): void {
    const kids = elChildren(parent);
    setChildren(parent, [...kids.slice(0, index), ...insert, ...kids.slice(index + remove)]);
}

/**
 * Place comment range markers around [start, end) of the paragraph's
 * accepted-view text. The passage text itself is unchanged.
 */
function insertCommentRange(
    paragraph: XNode,
    start: number,
    end: number,
    commentId: string,
): boolean {
    const pieces: TextPiece[] = [];
    collectTextPieces(paragraph, { n: 0 }, pieces);
    const startPiece = pieces.find((piece) => start >= piece.start && start < piece.end);
    const endPiece = pieces.find((piece) => end > piece.start && end <= piece.end);
    if (!startPiece || !endPiece) return false;

    const startRun = elChildren(startPiece.parent)[startPiece.runIndex];
    const endRun = elChildren(endPiece.parent)[endPiece.runIndex];
    if (!startRun || !endRun) return false;
    const startProps = runProps(startRun);
    const endProps = runProps(endRun);
    const startLocal = start - startPiece.start;
    const endLocal = end - endPiece.start;

    if (startPiece.parent === endPiece.parent && startPiece.runIndex === endPiece.runIndex) {
        const text = startPiece.text;
        const before = text.slice(0, startLocal);
        const mid = text.slice(startLocal, endLocal);
        const after = text.slice(endLocal);
        const nodes: XNode[] = [];
        if (before) nodes.push(buildRun(startProps, before, "w:t"));
        nodes.push(makeEl("w:commentRangeStart", [], { "w:id": commentId }));
        if (mid) nodes.push(buildRun(startProps, mid, "w:t"));
        nodes.push(makeEl("w:commentRangeEnd", [], { "w:id": commentId }));
        nodes.push(commentReferenceRun(commentId));
        if (after) nodes.push(buildRun(startProps, after, "w:t"));
        spliceChildren(startPiece.parent, startPiece.runIndex, 1, nodes);
        return true;
    }

    // End boundary first so the start run's index stays valid when they share a parent.
    const endText = endPiece.text;
    const endKeep = endText.slice(0, endLocal);
    const endRest = endText.slice(endLocal);
    const endNodes: XNode[] = [];
    if (endKeep) endNodes.push(buildRun(endProps, endKeep, "w:t"));
    endNodes.push(makeEl("w:commentRangeEnd", [], { "w:id": commentId }));
    endNodes.push(commentReferenceRun(commentId));
    if (endRest) endNodes.push(buildRun(endProps, endRest, "w:t"));
    spliceChildren(endPiece.parent, endPiece.runIndex, 1, endNodes);

    const startText = startPiece.text;
    const startKeep = startText.slice(0, startLocal);
    const startRest = startText.slice(startLocal);
    const startNodes: XNode[] = [];
    if (startKeep) startNodes.push(buildRun(startProps, startKeep, "w:t"));
    startNodes.push(makeEl("w:commentRangeStart", [], { "w:id": commentId }));
    if (startRest) startNodes.push(buildRun(startProps, startRest, "w:t"));
    spliceChildren(startPiece.parent, startPiece.runIndex, 1, startNodes);
    return true;
}

function nextRelationshipId(relsXml: string): string {
    let max = 0;
    for (const match of relsXml.matchAll(/\bId="rId(\d+)"/g)) {
        const n = parseInt(match[1], 10);
        if (n > max) max = n;
    }
    return `rId${max + 1}`;
}

function ensureRelationship(relsXml: string, type: string, target: string): string {
    if (relsXml.includes(type)) return relsXml;
    const id = nextRelationshipId(relsXml);
    const tag =
        `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
    if (relsXml.includes("</Relationships>")) {
        return relsXml.replace("</Relationships>", `${tag}</Relationships>`);
    }
    return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `${tag}</Relationships>`
    );
}

function ensureContentType(typesXml: string, partName: string, contentType: string): string {
    if (typesXml.includes(`PartName="${partName}"`)) return typesXml;
    const tag = `<Override PartName="${partName}" ContentType="${contentType}"/>`;
    if (typesXml.includes("</Types>")) {
        return typesXml.replace("</Types>", `${tag}</Types>`);
    }
    return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `${tag}</Types>`
    );
}

function maxCommentId(commentsRoot: XNode | null): number {
    let max = -1;
    if (!commentsRoot) return max;
    for (const node of elChildren(commentsRoot)) {
        if (elName(node) !== "w:comment") continue;
        const raw = attrOf(node, "@_w:id");
        const n = raw != null ? parseInt(raw, 10) : NaN;
        if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
}

function initialsFor(author: string): string {
    const letters = author
        .split(/\s+/)
        .map((part) => part[0])
        .filter(Boolean)
        .join("")
        .slice(0, 3)
        .toUpperCase();
    return letters || "M";
}

function newParaId(): string {
    return Math.floor(Math.random() * 0xffffffff)
        .toString(16)
        .toUpperCase()
        .padStart(8, "0");
}

function commentElement(
    id: string,
    author: string,
    initials: string,
    date: string,
    text: string,
    paraId: string,
): XNode {
    const paragraphs = text.split("\n").map((line) =>
        makeEl(
            "w:p",
            [makeEl("w:r", [makeEl("w:t", [makeText(line)], { "xml:space": "preserve" })])],
            { "w14:paraId": paraId },
        ),
    );
    // Only the first paragraph carries the paraId Word uses to thread replies.
    for (let i = 1; i < paragraphs.length; i += 1) {
        delete (paragraphs[i][ATTR_KEY] as Record<string, string>)["@_w14:paraId"];
    }
    return makeEl("w:comment", paragraphs, {
        "w:id": id,
        "w:author": author,
        "w:date": date,
        "w:initials": initials,
    });
}

/**
 * Insert Word review comments into a .docx. Each new comment is a real
 * comment bubble (range + comments part), so Word's review pane shows it.
 * Replies thread onto an existing comment id and do not add a second range.
 */
export async function applyDocxComments(
    bytes: Buffer,
    comments: CommentInput[],
    opts?: { author?: string },
): Promise<ApplyDocxCommentsResult> {
    const author = opts?.author ?? "Mike";
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const zip = await JSZip.loadAsync(bytes);
    const docXmlFile = getZipEntry(zip, "word/document.xml");
    if (!docXmlFile) throw new Error("document.xml missing from docx");

    const parser = createParser();
    const builder = createBuilder();
    const tree = parser.parse(await docXmlFile.async("string")) as XNode[];
    const bodyChildren = findBody(tree);
    if (!bodyChildren) throw new Error("w:body missing from document.xml");

    const paragraphs: XNode[] = [];
    const collectParagraphs = (nodes: XNode[]) => {
        for (const n of nodes) {
            const name = elName(n);
            if (!name) continue;
            if (name === "w:p") paragraphs.push(n);
            else if (
                name === "w:tbl" ||
                name === "w:tr" ||
                name === "w:tc" ||
                name === "w:sdt" ||
                name === "w:sdtContent"
            ) {
                collectParagraphs(elChildren(n));
            }
        }
    };
    collectParagraphs(bodyChildren);

    const commentsFile = getZipEntry(zip, "word/comments.xml");
    let commentsTree: XNode[] = commentsFile
        ? (parser.parse(await commentsFile.async("string")) as XNode[])
        : [];
    let commentsRoot = commentsTree.find((n) => elName(n) === "w:comments") ?? null;
    if (!commentsRoot) {
        commentsRoot = makeEl("w:comments", [], {
            "xmlns:w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            "xmlns:w14": "http://schemas.microsoft.com/office/word/2010/wordml",
        });
        commentsTree = [commentsRoot];
    }
    let nextId = maxCommentId(commentsRoot) + 1;

    const existingIds = new Set(
        elChildren(commentsRoot)
            .filter((node) => elName(node) === "w:comment")
            .map((node) => attrOf(node, "@_w:id"))
            .filter((id): id is string => !!id),
    );
    const paraIdByCommentId = new Map<string, string>();
    for (const node of elChildren(commentsRoot)) {
        if (elName(node) !== "w:comment") continue;
        const id = attrOf(node, "@_w:id");
        const paraId = firstParagraphParaId(node);
        if (id && paraId) paraIdByCommentId.set(id, paraId);
    }

    const extendedFile = getZipEntry(zip, "word/commentsExtended.xml");
    let extendedXml = extendedFile
        ? await extendedFile.async("string")
        : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"></w15:commentsEx>`;

    const applied: AppliedComment[] = [];
    const errors: EditError[] = [];
    const freshIds = new Set<string>();

    for (let index = 0; index < comments.length; index += 1) {
        const input = comments[index];
        const text = (input.text ?? "").trim();
        const anchor = input.anchor ?? "";
        const parentId = input.parent_id?.trim() || null;
        if (!text) {
            errors.push({ index, reason: "Comment text is empty." });
            continue;
        }
        if (parentId && !existingIds.has(parentId) && !freshIds.has(parentId)) {
            errors.push({
                index,
                reason: `No comment with id "${parentId}" to reply to.`,
            });
            continue;
        }
        if (!parentId && !anchor.trim()) {
            errors.push({
                index,
                reason: "A comment needs an anchor passage, or a parent_id to reply to.",
            });
            continue;
        }
        if (anchor.includes("\n")) {
            errors.push({
                index,
                reason: "The anchor must be one contiguous passage within a single paragraph.",
            });
            continue;
        }

        const id = String(nextId);
        const paraId = newParaId();
        nextId += 1;
        existingIds.add(id);
        freshIds.add(id);
        paraIdByCommentId.set(id, paraId);
        setChildren(commentsRoot, [
            ...elChildren(commentsRoot),
            commentElement(id, author, initialsFor(author), now, text, paraId),
        ]);

        if (parentId && !paraIdByCommentId.get(parentId)) {
            const assigned = newParaId();
            for (const node of elChildren(commentsRoot)) {
                if (elName(node) !== "w:comment" || attrOf(node, "@_w:id") !== parentId) continue;
                const first = elChildren(node).find((child) => elName(child) === "w:p");
                if (first) {
                    const attrs = elAttrs(first);
                    attrs["@_w14:paraId"] = assigned;
                    first[ATTR_KEY] = attrs;
                    paraIdByCommentId.set(parentId, assigned);
                }
            }
        }
        const parentPara = parentId ? paraIdByCommentId.get(parentId) : undefined;
        const exTag = parentPara
            ? `<w15:commentEx w15:paraId="${paraId}" w15:paraIdParent="${parentPara}" w15:done="0"/>`
            : `<w15:commentEx w15:paraId="${paraId}" w15:done="0"/>`;
        extendedXml = extendedXml.includes("</w15:commentsEx>")
            ? extendedXml.replace("</w15:commentsEx>", `${exTag}</w15:commentsEx>`)
            : extendedXml;

        if (!parentId) {
            const placed = placeCommentAnchor(paragraphs, anchor, input.context_before ?? "", input.context_after ?? "", id);
            if (!placed.ok) {
                errors.push({ index, reason: placed.reason });
                // Roll back the comment element we just appended.
                setChildren(
                    commentsRoot,
                    elChildren(commentsRoot).filter(
                        (node) => attrOf(node, "@_w:id") !== id,
                    ),
                );
                existingIds.delete(id);
                freshIds.delete(id);
                extendedXml = extendedXml.replace(exTag, "");
                continue;
            }
        }

        applied.push({
            id,
            anchor: parentId ? "" : anchor,
            text,
            parentId,
        });
    }

    if (applied.length === 0) {
        return { bytes, comments: [], errors };
    }

    setZipEntry(zip, "word/document.xml", ensureXmlDeclaration(builder.build(tree)));
    let commentsXml = ensureXmlDeclaration(builder.build(commentsTree));
    if (!commentsXml.includes("xmlns:w14=")) {
        commentsXml = commentsXml.replace(
            "<w:comments",
            `<w:comments xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"`,
        );
    }
    setZipEntry(zip, "word/comments.xml", commentsXml);
    setZipEntry(zip, "word/commentsExtended.xml", extendedXml);

    const relsPath = "word/_rels/document.xml.rels";
    const relsFile = getZipEntry(zip, relsPath);
    const relsXml = relsFile ? await relsFile.async("string") : "";
    let nextRels = ensureRelationship(relsXml, COMMENTS_REL_TYPE, "comments.xml");
    nextRels = ensureRelationship(nextRels, COMMENTS_EX_REL_TYPE, "commentsExtended.xml");
    setZipEntry(zip, relsPath, nextRels);

    const typesPath = "[Content_Types].xml";
    const typesFile = getZipEntry(zip, typesPath);
    const typesXml = typesFile ? await typesFile.async("string") : "";
    let nextTypes = ensureContentType(typesXml, "/word/comments.xml", COMMENTS_CONTENT_TYPE);
    nextTypes = ensureContentType(
        nextTypes,
        "/word/commentsExtended.xml",
        COMMENTS_EX_CONTENT_TYPE,
    );
    setZipEntry(zip, typesPath, nextTypes);

    const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    return { bytes: out, comments: applied, errors };
}

function placeCommentAnchor(
    paragraphs: XNode[],
    anchor: string,
    contextBefore: string,
    contextAfter: string,
    commentId: string,
): { ok: true } | { ok: false; reason: string } {
    const findNorm = normalizeWs(anchor).norm;
    const ctxBeforeNorm = normalizeWs(contextBefore).norm;
    const ctxAfterNorm = normalizeWs(contextAfter).norm;
    const paraText = (paragraph: XNode) => {
        const pieces: TextPiece[] = [];
        collectTextPieces(paragraph, { n: 0 }, pieces);
        return pieces.map((piece) => piece.text).join("");
    };
    const norms = paragraphs.map((paragraph) => normalizeWs(paraText(paragraph)));

    type Hit = { paraIdx: number; normStart: number; normEnd: number };
    const tryStrategy = (before: string, after: string): { kind: "ok"; hits: Hit[] } | { kind: "ambiguous" } => {
        const hits: Hit[] = [];
        let ambiguous = false;
        for (let i = 0; i < norms.length; i += 1) {
            const found = findUniqueAnchor(norms[i].norm, findNorm, before, after);
            if ("error" in found) {
                if (found.error === "ambiguous") ambiguous = true;
                continue;
            }
            hits.push({ paraIdx: i, normStart: found.start, normEnd: found.end });
        }
        if (ambiguous || hits.length > 1) return { kind: "ambiguous" };
        return { kind: "ok", hits };
    };

    let selected: Hit | null = null;
    let sawAmbiguous = false;
    for (const attempt of [
        { before: ctxBeforeNorm, after: ctxAfterNorm },
        { before: ctxBeforeNorm, after: "" },
        { before: "", after: ctxAfterNorm },
        { before: "", after: "" },
    ]) {
        const result = tryStrategy(attempt.before, attempt.after);
        if (result.kind === "ambiguous") {
            sawAmbiguous = true;
            continue;
        }
        if (result.hits.length === 1) {
            selected = result.hits[0];
            break;
        }
    }
    if (!selected) {
        return {
            ok: false,
            reason: sawAmbiguous
                ? `Ambiguous anchor "${truncate(anchor, 80)}". Add context_before and context_after so it is unique.`
                : `Could not locate anchor "${truncate(anchor, 80)}". Copy the passage verbatim from the document.`,
        };
    }
    const range = mapNormRangeToOriginal(
        norms[selected.paraIdx],
        paraText(paragraphs[selected.paraIdx]).length,
        selected.normStart,
        selected.normEnd,
    );
    if (range.end <= range.start) {
        return { ok: false, reason: "The anchor matched an empty range." };
    }
    const placed = insertCommentRange(
        paragraphs[selected.paraIdx],
        range.start,
        range.end,
        commentId,
    );
    if (!placed) return { ok: false, reason: "The anchor could not be marked in the paragraph." };
    return { ok: true };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function ensureXmlDeclaration(xml: string): string {
    if (xml.startsWith("<?xml")) return xml;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`;
}

function truncate(s: string, n: number): string {
    if (!s) return "";
    return s.length > n ? s.slice(0, n) + "…" : s;
}
