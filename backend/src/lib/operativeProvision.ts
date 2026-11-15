import { looksLikeBotChallenge } from "./officialSourceAccess";
import type { ExaContentsFetch } from "./exaContents";

const TITLE_LINE =
    /^(?:(?:section|clause)\s+)?\d+[A-Za-z]?(?:\.\d+)*\s+\S/i;

/**
 * A contents-page hit is a numbered title with no provision under it.
 * A subsection marker or any further sentence is the operative text.
 */
export function isOperativeProvision(text: string): boolean {
    const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    if (!lines.length) return false;
    if (lines.some((line) => /\(\d+[A-Za-z]?\)|\([a-z]\)/i.test(line))) {
        return true;
    }
    const body = lines.filter((line) => !isTitleLine(line)).join(" ").trim();
    return body.length >= 20;
}

function isTitleLine(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed.length > 140) return false;
    if (/\(\d+[A-Za-z]?\)|\([a-z]\)/i.test(trimmed)) return false;
    return TITLE_LINE.test(trimmed);
}

export function slicesFromHeadings(
    text: string,
    headings: { index: number; number: string }[],
    wanted: string,
): string[] {
    const target = wanted.toLowerCase();
    const slices: string[] = [];
    for (let i = 0; i < headings.length; i++) {
        const heading = headings[i];
        if (!heading || heading.number !== target) continue;
        const to = headings[i + 1]?.index ?? text.length;
        const slice = text.slice(heading.index, to).trim();
        if (slice) slices.push(slice);
    }
    return slices;
}

export function selectOperativeSlice(slices: string[]): string | null {
    return slices.find((slice) => isOperativeProvision(slice)) ?? null;
}

export function htmlToText(value: string): string {
    if (!/<[a-z!/]/i.test(value)) return value.replace(/\u0000/g, "").trim();
    return value
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<\/(?:h\d|li|div|tr|section)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export async function loadOfficialHtmlText(args: {
    url: string;
    fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
    exaFetch?: ExaContentsFetch;
}): Promise<{ text: string; url: string; via: "official" | "exa" } | null> {
    const href = args.url.trim();
    if (!href || /\.pdf(?:$|\?)/i.test(href)) return null;
    try {
        const response = await args.fetchImpl(href, {
            headers: { Accept: "text/html" },
        });
        if (response.ok) {
            const text = htmlToText(await response.text());
            if (usefulHtml(text)) return { text, url: href, via: "official" };
        }
    } catch {
        // The official HTML page can be blocked. Exa is the next read.
    }
    if (!args.exaFetch) return null;
    const fetched = await args.exaFetch(href);
    if (!fetched?.text) return null;
    const text = htmlToText(fetched.text);
    if (!usefulHtml(text)) return null;
    return { text, url: href, via: "exa" };
}

function usefulHtml(text: string): boolean {
    if (text.length < 80) return false;
    return !looksLikeBotChallenge(Buffer.from(text.slice(0, 1200)));
}
