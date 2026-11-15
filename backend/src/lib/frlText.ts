import JSZip from "jszip";

export type FrlProvision = {
    no: string;
    heading: string;
    context: string;
    body: string;
};

export type ActText = {
    provisions: FrlProvision[];
    endnotes: string;
};

const ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
};

export function decodeEntities(value: string): string {
    return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code: string) => {
        if (code.startsWith("#x") || code.startsWith("#X")) {
            return String.fromCodePoint(parseInt(code.slice(2), 16));
        }
        if (code.startsWith("#")) {
            return String.fromCodePoint(parseInt(code.slice(1), 10));
        }
        return ENTITIES[code.toLowerCase()] ?? match;
    });
}

function textOf(inner: string): string {
    const withFormulas = inner.replace(
        /<img\b[^>]*?\balt="([^"]*)"[^>]*>/gi,
        " $1 ",
    );
    return decodeEntities(withFormulas.replace(/<[^>]+>/g, ""))
        .replace(/\s+/g, " ")
        .trim();
}

type HtmlBlock = {
    cls: string;
    sectNo: string | null;
    heading: string;
    text: string;
};

const SECTNO_SPAN = /<span\b[^>]*CharSectno[^>]*>([\s\S]*?)<\/span>/gi;

export function htmlBlocks(html: string): HtmlBlock[] {
    const blocks: HtmlBlock[] = [];
    const re = /<(p|h[1-6])\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
    for (let match = re.exec(html); match; match = re.exec(html)) {
        const tag = (match[1] ?? "").toLowerCase();
        const attrs = match[2] ?? "";
        const inner = match[3] ?? "";
        const level = /^h([1-6])$/.exec(tag);
        const cls =
            /class="([^"]*)"/.exec(attrs)?.[1] ??
            (level ? `ActHead${Math.min(Number(level[1]), 5)}` : "");
        const parts = [...inner.matchAll(SECTNO_SPAN)].map((span) =>
            textOf(span[1] ?? ""),
        );
        const sectNo = parts.length > 0 ? parts.join("") : null;
        const text = textOf(inner);
        const heading = textOf(inner.replace(SECTNO_SPAN, ""));
        if (!text && !sectNo) continue;
        blocks.push({ cls, sectNo: sectNo || null, heading, text });
    }
    return blocks;
}

export async function epubDocuments(epub: Uint8Array): Promise<string[]> {
    const zip = await JSZip.loadAsync(epub);
    const names = Object.keys(zip.files)
        .filter((name) => /document_\d+\.html$/i.test(name))
        .sort((a, b) => {
            const left = Number(/(\d+)\.html$/i.exec(a)?.[1] ?? 0);
            const right = Number(/(\d+)\.html$/i.exec(b)?.[1] ?? 0);
            return left - right;
        });
    if (!names.length) {
        throw new Error("no document html found inside the epub");
    }
    return Promise.all(
        names.map(async (name) => {
            const file = zip.file(name);
            return file ? file.async("string") : "";
        }),
    );
}

const SKIP = /^(TOC\d*|Header|ShortT|Tabbing|UpdateDate)$/;
const SCHEDULE = /^(Schedule\s*[\w]+)\s*(?:[—–-]\s*)?(.*)$/i;
const LEADING_NO = /^(\d+[A-Z]{0,8}(?:[-‑.]\d+[A-Z]{0,8})?)\s+(.+)$/;
const ENDNOTE = /^(ENote|EndNote|NotesSection|TableOf|ActNotes)/;

function parseDocument(
    html: string,
    provisions: FrlProvision[],
    endnoteLines: string[],
): void {
    const context: string[] = [];
    let current: FrlProvision | null = null;
    let inSchedule = false;
    let inEndnotes = false;

    function open(no: string, heading: string): FrlProvision {
        const provision: FrlProvision = {
            no,
            heading,
            context: context.filter(Boolean).join(" > "),
            body: "",
        };
        provisions.push(provision);
        return provision;
    }

    for (const block of htmlBlocks(html)) {
        if (SKIP.test(block.cls)) continue;
        if (ENDNOTE.test(block.cls)) {
            inEndnotes = true;
            current = null;
            if (block.text) endnoteLines.push(block.text);
            continue;
        }
        if (inEndnotes) {
            if (block.text) endnoteLines.push(block.text);
            continue;
        }

        if (/^LI-Heading[1-6]$/.test(block.cls)) {
            const schedule = SCHEDULE.exec(block.text);
            if (schedule) {
                context.length = 0;
                inSchedule = true;
                current = open(
                    (schedule[1] ?? block.text).replace(/\s+/g, " "),
                    schedule[2] ?? "",
                );
                continue;
            }
            const numbered = LEADING_NO.exec(block.text);
            if (numbered) {
                inSchedule = false;
                current = open(numbered[1]!, numbered[2]!);
                continue;
            }
            context.length = 0;
            context[0] = block.text;
            inSchedule = false;
            current = null;
            continue;
        }

        const head = /^ActHead([1-5])$/.exec(block.cls);
        if (head) {
            const depth = Number(head[1]);
            if (depth === 5 && block.sectNo) {
                current = open(block.sectNo, block.heading);
                continue;
            }
            const schedule = depth === 1 ? SCHEDULE.exec(block.text) : null;
            if (schedule) {
                context.length = 0;
                inSchedule = true;
                current = open(
                    (schedule[1] ?? block.text).replace(/\s+/g, " "),
                    schedule[2] ?? "",
                );
                continue;
            }
            if (inSchedule && depth > 1) {
                if (current && block.text) {
                    current.body += (current.body ? "\n" : "") + block.text;
                }
                continue;
            }
            context.length = depth - 1;
            context[depth - 1] = block.text;
            inSchedule = false;
            current = null;
            continue;
        }

        if (current && block.text) {
            current.body += (current.body ? "\n" : "") + block.text;
        }
    }
}

export function parseActHtml(html: string | string[]): ActText {
    const docs = Array.isArray(html) ? html : [html];
    const provisions: FrlProvision[] = [];
    const endnoteLines: string[] = [];
    for (const doc of docs) {
        parseDocument(doc, provisions, endnoteLines);
    }
    return { provisions, endnotes: endnoteLines.join("\n") };
}

export async function parseActFromEpub(epub: Uint8Array): Promise<ActText> {
    const documents = await epubDocuments(epub);
    return parseActHtml(documents);
}

export function normaliseSectionNo(no: string): string {
    return no
        .replace(/[‐‑‒–—−]/g, "-")
        .replace(/\s+/g, "")
        .replace(/^(?:ss?|sect(?:ion)?|reg(?:ulation)?|r|cl(?:ause)?)\.?(?=\d|Schedule)/i, "")
        .toUpperCase();
}

export function findProvision(
    act: ActText,
    sectionNo: string,
): FrlProvision | null {
    const want = normaliseSectionNo(sectionNo);
    return (
        act.provisions.find(
            (provision) => normaliseSectionNo(provision.no) === want,
        ) ?? null
    );
}

export function actFullText(act: ActText): string {
    return act.provisions
        .map((provision) => {
            const heading = provision.heading
                ? `${provision.no} ${provision.heading}`
                : provision.no;
            return `${heading}\n${provision.body}`.trim();
        })
        .join("\n\n");
}
