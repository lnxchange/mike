import {
    cacheForInjectedFetch,
    fetchOfficialBytes,
    type OfficialFileCache,
} from "./officialFileCache";
import { extractPdfText } from "./pdfText";
import { devLog } from "./log";

const USER_AGENT = "mike-legal-assistant (https://github.com/lnxchange/mike)";
const NSW_SEARCH = "https://www.caselaw.nsw.gov.au/search";
const NSW_DECISION = "https://www.caselaw.nsw.gov.au/decision";
const FCA_SEARCH = "https://search.judgments.fedcourt.gov.au/s/search.html";
const HCA_CASE = "https://eresources.hcourt.gov.au/showCase";
const VSC_SEARCH = "https://www.supremecourt.vic.gov.au/search";
const VSC_JUDGMENTS =
    "https://www.supremecourt.vic.gov.au/areas/case-summaries/judgments";

export class AuCaseError extends Error {
    status?: number;

    constructor(message: string, status?: number) {
        super(message);
        this.name = "AuCaseError";
        this.status = status;
    }
}

export type CaseFetch = (
    input: string,
    init?: RequestInit,
) => Promise<Response>;

export type AuCaseHit = {
    id: string;
    citation: string;
    name: string;
    court: string;
    date: string | null;
    url: string;
    source: "nsw" | "fca" | "hca" | "vsc";
};

export type AuCaseText = {
    id: string;
    citation: string;
    name: string;
    court: string;
    date: string | null;
    url: string;
    section: string | null;
    page: number;
    pageCount: number;
    text: string;
    attribution: string;
};

type CaseOptions = {
    fetchImpl?: CaseFetch;
    extractPdf?: (bytes: ArrayBuffer) => Promise<string>;
    cache?: OfficialFileCache;
};

const MNC_RE =
    /\[(\d{4})\]\s*(HCA|FCAFC|FCA|NSWSC|NSWCA|NSWCCA|NSWCATAP|NSWCATCD|VSC|VSCA|QCA|QSC)\s+(\d+)/i;

export function parseMediumNeutralCitation(query: string): {
    year: string;
    court: string;
    number: string;
    citation: string;
} | null {
    const match = query.match(MNC_RE);
    if (!match) return null;
    const court = match[2].toUpperCase();
    return {
        year: match[1],
        court,
        number: match[3],
        citation: `[${match[1]}] ${court} ${match[3]}`,
    };
}

function request(
    fetchImpl: CaseFetch,
    url: string,
    init: RequestInit = {},
): Promise<Response> {
    return fetchImpl(url, {
        ...init,
        headers: {
            Accept: "text/html, application/pdf, */*",
            "User-Agent": USER_AGENT,
            ...(init.headers ?? {}),
        },
    });
}

function stripHtml(value: string): string {
    return value
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<\/h[1-6]>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export function parseNswSearch(html: string): AuCaseHit[] {
    const hits: AuCaseHit[] = [];
    const seen = new Set<string>();
    const rowRe =
        /href="\/decision\/([a-f0-9]+)"[^>]*>[\s\S]{0,400}?\[(\d{4})\]\s*([A-Z]+)\s+(\d+)/gi;
    let match: RegExpExecArray | null;
    while ((match = rowRe.exec(html))) {
        const id = `nsw:${match[1]}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const citation = `[${match[2]}] ${match[3]} ${match[4]}`;
        const before = html.slice(Math.max(0, match.index - 400), match.index);
        const nameMatch = before.match(/>([^<]{6,160})<\/a>\s*$/);
        hits.push({
            id,
            citation,
            name: nameMatch?.[1]?.trim() || citation,
            court: match[3],
            date: null,
            url: `${NSW_DECISION}/${match[1]}`,
            source: "nsw",
        });
    }
    return hits;
}

export function parseNswDecision(html: string, id: string): AuCaseText {
    const citationMatch = html.match(
        /Medium Neutral Citation:[\s\S]{0,200}?(\[[12]\d{3}\]\s+[A-Z]+\s+\d+)/i,
    );
    const nameMatch = html.match(/<title>\s*([^<\n]+)/i);
    const courtMatch = html.match(/<h1>\s*([^<]+)/i);
    const body =
        html.match(
            /<div[^>]+class="[^"]*decision[^"]*"[^>]*>([\s\S]+?)<div class="[^"]*footer/i,
        )?.[1] ??
        html.match(/<div id="judgment"[\s\S]+/i)?.[0] ??
        html;
    return {
        id,
        citation: citationMatch?.[1]?.replace(/\s+/g, " ").trim() ?? id,
        name: nameMatch?.[1]?.replace(/\s+-\s+NSW Caselaw.*/i, "").trim() ?? id,
        court: courtMatch?.[1]?.replace(/\s+/g, " ").trim() ?? "NSW",
        date: null,
        url: id.startsWith("nsw:")
            ? `${NSW_DECISION}/${id.slice(4)}`
            : `${NSW_DECISION}/${id}`,
        section: null,
        page: 1,
        pageCount: 1,
        text: stripHtml(body).slice(0, 40000),
        attribution:
            "Judgment © the relevant court, sourced from caselaw.nsw.gov.au.",
    };
}

export function parseFcaSearch(html: string): AuCaseHit[] {
    const hits: AuCaseHit[] = [];
    const seen = new Set<string>();
    const rowRe =
        /href="(https?:\/\/[^"]+)"[^>]*>[\s\S]{0,240}?(\[[12]\d{3}\]\s+(?:FCAFC|FCA)\s+\d+)/gi;
    let match: RegExpExecArray | null;
    while ((match = rowRe.exec(html))) {
        const citation = match[2].replace(/\s+/g, " ");
        if (seen.has(citation)) continue;
        seen.add(citation);
        hits.push({
            id: `fca:${citation.replace(/\s+/g, "")}`,
            citation,
            name: citation,
            court: citation.includes("FCAFC") ? "FCAFC" : "FCA",
            date: null,
            url: match[1],
            source: "fca",
        });
    }
    return hits;
}

export function officialCaseUrl(citation: string): AuCaseHit | null {
    const parsed = parseMediumNeutralCitation(citation);
    if (!parsed) return null;
    if (parsed.court === "HCA") {
        return {
            id: `hca:${parsed.year}:${parsed.number}`,
            citation: parsed.citation,
            name: parsed.citation,
            court: "HCA",
            date: `${parsed.year}-01-01`,
            url: `${HCA_CASE}/${parsed.year}/HCA/${parsed.number}`,
            source: "hca",
        };
    }
    if (parsed.court === "FCA" || parsed.court === "FCAFC") {
        const series = parsed.court === "FCAFC" ? "FCAFC" : "FCA";
        return {
            id: `fca:${parsed.citation.replace(/\s+/g, "")}`,
            citation: parsed.citation,
            name: parsed.citation,
            court: series,
            date: `${parsed.year}-01-01`,
            url: `${FCA_SEARCH}?collection=fca~sp-judgments-internet&profile=judgments-internet&query=${encodeURIComponent(parsed.citation)}`,
            source: "fca",
        };
    }
    if (parsed.court.startsWith("NSW")) {
        return {
            id: `nsw-cite:${parsed.citation.replace(/\s+/g, "")}`,
            citation: parsed.citation,
            name: parsed.citation,
            court: parsed.court,
            date: `${parsed.year}-01-01`,
            url: `${NSW_SEARCH}?query=${encodeURIComponent(parsed.citation)}`,
            source: "nsw",
        };
    }
    if (parsed.court === "VSC" || parsed.court === "VSCA") {
        return {
            id: `vsc:${parsed.citation.replace(/\s+/g, "")}`,
            citation: parsed.citation,
            name: parsed.citation,
            court: parsed.court,
            date: `${parsed.year}-01-01`,
            url: `${VSC_SEARCH}?keys=${encodeURIComponent(parsed.citation)}`,
            source: "vsc",
        };
    }
    return null;
}

export function parseVscSearch(html: string, citation?: string): AuCaseHit[] {
    const hits: AuCaseHit[] = [];
    const seen = new Set<string>();
    const hrefRe =
        /href="((?:https:\/\/www\.supremecourt\.vic\.gov\.au)?\/sites\/default\/files\/[^"]+\.pdf)"/gi;
    const wanted = citation
        ? citation.replace(/\s+/g, "").toLowerCase()
        : null;
    let match: RegExpExecArray | null;
    while ((match = hrefRe.exec(html))) {
        const raw = match[1];
        const url = raw.startsWith("http")
            ? raw
            : `https://www.supremecourt.vic.gov.au${raw}`;
        const decoded = decodeURIComponent(url);
        if (/summary/i.test(decoded)) continue;
        const nearby = `${html.slice(Math.max(0, match.index - 400), match.index + 400)} ${decoded}`;
        const citeMatch = nearby.match(/\[(\d{4})\]\s*(VSCA|VSC)\s+(\d+)/i);
        const found = citeMatch
            ? `[${citeMatch[1]}] ${citeMatch[2].toUpperCase()} ${citeMatch[3]}`
            : citation ?? null;
        if (!found) continue;
        const compact = found.replace(/\s+/g, "").toLowerCase();
        if (wanted && !compact.includes(wanted) && !decoded.replace(/\s+/g, "").toLowerCase().includes(wanted)) {
            continue;
        }
        if (seen.has(url) || seen.has(compact)) continue;
        seen.add(url);
        seen.add(compact);
        hits.push({
            id: `vsc:${found.replace(/\s+/g, "")}`,
            citation: found,
            name: found,
            court: found.includes("VSCA") ? "VSCA" : "VSC",
            date: null,
            url,
            source: "vsc",
        });
    }
    return hits;
}

function compactFcaCitation(id: string): string | null {
    const match = id
        .replace(/^fca:/i, "")
        .match(/\[(\d{4})\](FCAFC|FCA)(\d+)/i);
    if (!match) return null;
    return `[${match[1]}] ${match[2].toUpperCase()} ${match[3]}`;
}

function hcaShowCaseUrl(id: string): string | null {
    const match = id.match(/^hca:(\d{4}):(\d+)$/i);
    if (!match) return null;
    return `${HCA_CASE}/${match[1]}/HCA/${match[2]}`;
}

async function searchVscCases(
    query: string,
    options: CaseOptions,
): Promise<AuCaseHit[]> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const parsed = parseMediumNeutralCitation(query);
    const citation =
        parsed?.court === "VSC" || parsed?.court === "VSCA"
            ? parsed.citation
            : undefined;
    const urls = [
        `${VSC_SEARCH}?keys=${encodeURIComponent(citation ?? query)}`,
        VSC_JUDGMENTS,
    ];
    const hits: AuCaseHit[] = [];
    for (const url of urls) {
        const response = await request(fetchImpl, url);
        if (!response.ok) continue;
        hits.push(...parseVscSearch(await response.text(), citation));
        if (hits.length) break;
    }
    return hits;
}

export async function searchAuCases(
    query: string,
    options: CaseOptions & { limit?: number } = {},
): Promise<AuCaseHit[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 10, 20));
    const fetchImpl = options.fetchImpl ?? fetch;
    const citation = officialCaseUrl(query);
    const hits: AuCaseHit[] = [];
    if (citation) hits.push(citation);
    if (citation?.source === "vsc") {
        hits.push(...(await searchVscCases(query, options)));
        const seenVic = new Set<string>();
        return hits
            .filter((hit) => {
                if (seenVic.has(hit.citation) || seenVic.has(hit.id)) return false;
                seenVic.add(hit.citation);
                seenVic.add(hit.id);
                return true;
            })
            .slice(0, limit);
    }

    const nsw = await request(
        fetchImpl,
        `${NSW_SEARCH}?query=${encodeURIComponent(query)}`,
    );
    if (nsw.status === 429) {
        throw new AuCaseError(
            "NSW Caselaw rate-limited this request. Stop further Australian case-law calls this turn.",
            429,
        );
    }
    if (nsw.ok) hits.push(...parseNswSearch(await nsw.text()));

    const fca = await request(
        fetchImpl,
        `${FCA_SEARCH}?collection=fca~sp-judgments-internet&profile=judgments-internet&query=${encodeURIComponent(query)}`,
    );
    if (fca.ok) hits.push(...parseFcaSearch(await fca.text()));

    const seen = new Set<string>();
    return hits
        .filter((hit) => {
            if (seen.has(hit.citation) || seen.has(hit.id)) return false;
            seen.add(hit.citation);
            seen.add(hit.id);
            return true;
        })
        .slice(0, limit);
}

export function paginateText(
    text: string,
    page = 1,
): { text: string; page: number; pageCount: number } {
    const pageSize = 7000;
    const pageCount = Math.max(1, Math.ceil(text.length / pageSize));
    const safePage = Math.min(Math.max(page, 1), pageCount);
    const start = (safePage - 1) * pageSize;
    return {
        text: text.slice(start, start + pageSize),
        page: safePage,
        pageCount,
    };
}

export function findCasePassage(
    text: string,
    paragraph?: string | null,
    page = 1,
): { text: string; section: string | null; page: number; pageCount: number } {
    if (!paragraph?.trim()) {
        return { ...paginateText(text, page), section: null };
    }
    const wanted = paragraph.trim().replace(/^\[|\]$/g, "");
    const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const heading = new RegExp(
        `(^|\\n)\\s*\\[?${escaped}\\]?\\b[\\s\\S]*?(?=\\n\\s*\\[?(?!${escaped}\\b)\\d+[A-Za-z]?\\]?\\s+|$)`,
        "i",
    );
    const match = text.match(heading);
    if (!match) {
        throw new AuCaseError(
            `Paragraph ${wanted} was not found in the fetched judgment.`,
        );
    }
    return {
        text: match[0].trim(),
        section: wanted,
        page: 1,
        pageCount: 1,
    };
}

async function readFetchedText(
    response: Response,
    url: string,
    options: CaseOptions,
    bytesOverride?: Buffer,
): Promise<string> {
    const contentType = response.headers.get("content-type") ?? "";
    const bytes =
        bytesOverride ?? Buffer.from(await response.arrayBuffer());
    if (contentType.includes("pdf") || url.toLowerCase().endsWith(".pdf")) {
        const view = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        const extract = options.extractPdf ?? extractPdfText;
        return extract(view);
    }
    return stripHtml(bytes.toString("utf8"));
}

async function downloadCaseFile(
    fetchImpl: CaseFetch,
    url: string,
    options: CaseOptions,
): Promise<{ text: string; url: string }> {
    if (url.toLowerCase().includes(".pdf")) {
        const downloaded = await fetchOfficialBytes(
            (href, init) => request(fetchImpl, href, init),
            url,
            {},
            cacheForInjectedFetch(options.fetchImpl, options.cache),
        );
        if (downloaded.status !== 200) {
            throw new AuCaseError(
                `Could not download the official judgment PDF.`,
                downloaded.status,
            );
        }
        const view = downloaded.bytes.buffer.slice(
            downloaded.bytes.byteOffset,
            downloaded.bytes.byteOffset + downloaded.bytes.byteLength,
        ) as ArrayBuffer;
        const extract = options.extractPdf ?? extractPdfText;
        return { text: await extract(view), url };
    }
    const response = await request(fetchImpl, url);
    if (!response.ok) {
        throw new AuCaseError(
            `Could not read the official judgment.`,
            response.status,
        );
    }
    return {
        text: await readFetchedText(response, url, options),
        url,
    };
}

async function resolveFcaJudgmentUrl(
    citation: string,
    options: CaseOptions,
): Promise<string> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await request(
        fetchImpl,
        `${FCA_SEARCH}?collection=fca~sp-judgments-internet&profile=judgments-internet&query=${encodeURIComponent(citation)}`,
    );
    if (!response.ok) {
        throw new AuCaseError(
            `Could not search the Federal Court for ${citation}.`,
            response.status,
        );
    }
    const hit = parseFcaSearch(await response.text()).find(
        (row) =>
            /judgments\.fedcourt\.gov\.au|\.pdf(\?|$)/i.test(row.url) &&
            !row.url.includes("search.html"),
    );
    if (!hit) {
        throw new AuCaseError(
            `Could not resolve an official Federal Court judgment URL for ${citation}.`,
        );
    }
    return hit.url;
}

export async function getAuCase(
    caseId: string,
    options: CaseOptions & { page?: number; paragraph?: string } = {},
): Promise<AuCaseText> {
    const fetchImpl = options.fetchImpl ?? fetch;
    if (caseId.startsWith("nsw:") || caseId.startsWith("nsw-cite:")) {
        const id = caseId.startsWith("nsw:")
            ? caseId
            : (await searchAuCases(caseId.replace(/^nsw-cite:/, ""), options))[0]
                  ?.id;
        if (!id?.startsWith("nsw:")) {
            throw new AuCaseError(
                `Could not resolve ${caseId} on NSW Caselaw.`,
            );
        }
        const response = await request(
            fetchImpl,
            `${NSW_DECISION}/${id.slice(4)}`,
        );
        if (!response.ok) {
            throw new AuCaseError(
                `Could not read NSW Caselaw decision ${id}.`,
                response.status,
            );
        }
        const fetched = parseNswDecision(await response.text(), id);
        return {
            ...fetched,
            ...findCasePassage(fetched.text, options.paragraph, options.page),
        };
    }

    const citationHit = officialCaseUrl(caseId);
    const vscQuery =
        caseId.startsWith("vsc:")
            ? caseId.replace(/^vsc:/, "").replace(/(\d{4})(VSC(?:A)?)(\d+)/i, "[$1] $2 $3")
            : citationHit?.source === "vsc"
              ? citationHit.citation
              : null;
    if (vscQuery) {
        const pdfHit = (await searchVscCases(vscQuery, options)).find((hit) =>
            /\.pdf(\?|$)/i.test(hit.url),
        );
        if (!pdfHit) {
            throw new AuCaseError(
                `No official Supreme Court of Victoria PDF was found for ${citationHit?.citation ?? vscQuery} on supremecourt.vic.gov.au. The Court publishes only some recent judgments there. AustLII is not used.`,
            );
        }
        const downloaded = await downloadCaseFile(fetchImpl, pdfHit.url, options);
        const found = findCasePassage(
            downloaded.text,
            options.paragraph,
            options.page,
        );
        devLog("[au-cases] get", { id: caseId, url: downloaded.url });
        return {
            id: pdfHit.id,
            citation: pdfHit.citation,
            name: pdfHit.name,
            court: pdfHit.court,
            date: pdfHit.date,
            url: downloaded.url,
            ...found,
            attribution:
                "Judgment © the Supreme Court of Victoria, sourced from supremecourt.vic.gov.au.",
        };
    }

    const hcaUrl =
        hcaShowCaseUrl(caseId) ??
        (citationHit?.source === "hca" ? citationHit.url : null);
    const fcaCitation =
        compactFcaCitation(caseId) ??
        (citationHit?.source === "fca" ? citationHit.citation : null);
    const url =
        hcaUrl ??
        (fcaCitation ? await resolveFcaJudgmentUrl(fcaCitation, options) : null);
    if (!url) {
        throw new AuCaseError(
            `"${caseId}" is not a known official Australian case id. Search first.`,
        );
    }
    const downloaded = await downloadCaseFile(fetchImpl, url, options);
    const found = findCasePassage(
        downloaded.text,
        options.paragraph,
        options.page,
    );
    const source = hcaUrl || citationHit?.source === "hca" ? "hca" : "fca";
    devLog("[au-cases] get", { id: caseId, url: downloaded.url });
    return {
        id: citationHit?.id ?? caseId,
        citation: citationHit?.citation ?? fcaCitation ?? caseId,
        name: citationHit?.name ?? citationHit?.citation ?? caseId,
        court: citationHit?.court ?? (source === "hca" ? "HCA" : "FCA"),
        date: citationHit?.date ?? null,
        url: downloaded.url,
        ...found,
        attribution:
            source === "hca"
                ? "Judgment © High Court of Australia, sourced from eresources.hcourt.gov.au."
                : "Judgment © the Federal Court of Australia, sourced from judgments.fedcourt.gov.au.",
    };
}
