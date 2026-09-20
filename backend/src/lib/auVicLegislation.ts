import {
    cacheForInjectedFetch,
    fetchOfficialBytes,
    type OfficialFileCache,
} from "./officialFileCache";
import { extractPdfText } from "./pdfText";
import { devLog } from "./log";

const TIDE = "https://www.legislation.vic.gov.au/api/tide/page";
const WEB = "https://www.legislation.vic.gov.au";
const FILES = "https://content.legislation.vic.gov.au/sites/default/files";
const USER_AGENT = "mike-legal-assistant (https://github.com/lnxchange/mike)";
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMBER_RE = /Act number\s+(\d+)\s*\/\s*(\d{4})/i;

export class AuVicError extends Error {
    status?: number;

    constructor(message: string, status?: number) {
        super(message);
        this.name = "AuVicError";
        this.status = status;
    }
}

export type VicFetch = (
    input: string,
    init?: RequestInit,
) => Promise<Response>;

export type VicCollection = "acts" | "statutory-rules";

export type VicTitle = {
    id: string;
    slug: string;
    name: string;
    collection: VicCollection;
    number: string | null;
    year: number | null;
    url: string;
};

export type VicVersion = {
    titleId: string;
    label: string;
    start: string;
    end: string | null;
    isLatest: boolean;
    url: string;
    fileUrl: string | null;
};

export type VicText = {
    titleId: string;
    name: string;
    asAt: string | null;
    versionLabel: string | null;
    start: string | null;
    end: string | null;
    url: string;
    section: string | null;
    page: number;
    pageCount: number;
    text: string;
    attribution: string;
};

type VicOptions = {
    fetchImpl?: VicFetch;
    extractPdf?: (bytes: ArrayBuffer) => Promise<string>;
    cache?: OfficialFileCache;
};

const KNOWN: Array<{
    slug: string;
    name: string;
    collection: VicCollection;
    aliases: string[];
}> = [
    {
        slug: "electricity-industry-act-2000",
        name: "Electricity Industry Act 2000",
        collection: "acts",
        aliases: ["eia", "electricity industry act"],
    },
    {
        slug: "gas-industry-act-2001",
        name: "Gas Industry Act 2001",
        collection: "acts",
        aliases: ["gia", "gas industry act"],
    },
    {
        slug: "essential-services-commission-act-2001",
        name: "Essential Services Commission Act 2001",
        collection: "acts",
        aliases: ["esc act", "essential services commission act"],
    },
    {
        slug: "national-electricity-victoria-act-2005",
        name: "National Electricity (Victoria) Act 2005",
        collection: "acts",
        aliases: ["neva", "national electricity victoria"],
    },
    {
        slug: "national-gas-victoria-act-2008",
        name: "National Gas (Victoria) Act 2008",
        collection: "acts",
        aliases: ["ngva", "national gas victoria"],
    },
    {
        slug: "electricity-safety-act-1998",
        name: "Electricity Safety Act 1998",
        collection: "acts",
        aliases: ["electricity safety act"],
    },
    {
        slug: "gas-safety-act-1997",
        name: "Gas Safety Act 1997",
        collection: "acts",
        aliases: ["gas safety act"],
    },
    {
        slug: "victorian-energy-efficiency-target-act-2007",
        name: "Victorian Energy Efficiency Target Act 2007",
        collection: "acts",
        aliases: ["veet", "victorian energy efficiency target"],
    },
    {
        slug: "climate-change-act-2017",
        name: "Climate Change Act 2017",
        collection: "acts",
        aliases: ["climate change act"],
    },
    {
        slug: "energy-safe-victoria-act-2005",
        name: "Energy Safe Victoria Act 2005",
        collection: "acts",
        aliases: ["energy safe victoria act", "esv act"],
    },
    {
        slug: "renewable-energy-jobs-and-investment-act-2017",
        name: "Renewable Energy (Jobs and Investment) Act 2017",
        collection: "acts",
        aliases: ["renewable energy jobs and investment", "reji"],
    },
    {
        slug: "victorian-renewable-energy-act-2006",
        name: "Victorian Renewable Energy Act 2006",
        collection: "acts",
        aliases: ["victorian renewable energy act", "vret"],
    },
    {
        slug: "australian-consumer-law-and-fair-trading-act-2012",
        name: "Australian Consumer Law and Fair Trading Act 2012",
        collection: "acts",
        aliases: ["aclfta", "fair trading act victoria"],
    },
    {
        slug: "interpretation-of-legislation-act-1984",
        name: "Interpretation of Legislation Act 1984",
        collection: "acts",
        aliases: ["interpretation of legislation act"],
    },
    {
        slug: "subordinate-legislation-act-1994",
        name: "Subordinate Legislation Act 1994",
        collection: "acts",
        aliases: ["subordinate legislation act"],
    },
    {
        slug: "freedom-of-information-act-1982",
        name: "Freedom of Information Act 1982",
        collection: "acts",
        aliases: ["foi act", "freedom of information act"],
    },
    {
        slug: "privacy-and-data-protection-act-2014",
        name: "Privacy and Data Protection Act 2014",
        collection: "acts",
        aliases: ["privacy and data protection act", "pdpa"],
    },
    {
        slug: "charter-of-human-rights-and-responsibilities-act-2006",
        name: "Charter of Human Rights and Responsibilities Act 2006",
        collection: "acts",
        aliases: ["charter of human rights", "victorian charter"],
    },
    {
        slug: "environment-protection-act-2017",
        name: "Environment Protection Act 2017",
        collection: "acts",
        aliases: ["environment protection act"],
    },
    {
        slug: "occupational-health-and-safety-act-2004",
        name: "Occupational Health and Safety Act 2004",
        collection: "acts",
        aliases: ["ohs act", "occupational health and safety act"],
    },
    {
        slug: "civil-procedure-act-2010",
        name: "Civil Procedure Act 2010",
        collection: "acts",
        aliases: ["civil procedure act"],
    },
    {
        slug: "evidence-act-2008",
        name: "Evidence Act 2008",
        collection: "acts",
        aliases: ["evidence act victoria"],
    },
    {
        slug: "limitation-of-actions-act-1958",
        name: "Limitation of Actions Act 1958",
        collection: "acts",
        aliases: ["limitation of actions act"],
    },
    {
        slug: "wrongs-act-1958",
        name: "Wrongs Act 1958",
        collection: "acts",
        aliases: ["wrongs act"],
    },
    {
        slug: "supreme-court-act-1986",
        name: "Supreme Court Act 1986",
        collection: "acts",
        aliases: ["supreme court act victoria"],
    },
    {
        slug: "victorian-civil-and-administrative-tribunal-act-1998",
        name: "Victorian Civil and Administrative Tribunal Act 1998",
        collection: "acts",
        aliases: ["vcat act"],
    },
    {
        slug: "public-administration-act-2004",
        name: "Public Administration Act 2004",
        collection: "acts",
        aliases: ["public administration act"],
    },
    {
        slug: "planning-and-environment-act-1987",
        name: "Planning and Environment Act 1987",
        collection: "acts",
        aliases: ["planning and environment act"],
    },
    {
        slug: "water-act-1989",
        name: "Water Act 1989",
        collection: "acts",
        aliases: ["water act victoria"],
    },
    {
        slug: "building-act-1993",
        name: "Building Act 1993",
        collection: "acts",
        aliases: ["building act victoria"],
    },
    {
        slug: "owners-corporations-act-2006",
        name: "Owners Corporations Act 2006",
        collection: "acts",
        aliases: ["owners corporations act"],
    },
    {
        slug: "residential-tenancies-act-1997",
        name: "Residential Tenancies Act 1997",
        collection: "acts",
        aliases: ["residential tenancies act"],
    },
    {
        slug: "sale-of-land-act-1962",
        name: "Sale of Land Act 1962",
        collection: "acts",
        aliases: ["sale of land act"],
    },
    {
        slug: "local-government-act-2020",
        name: "Local Government Act 2020",
        collection: "acts",
        aliases: ["local government act victoria"],
    },
    {
        slug: "electricity-safety-electric-line-clearance-regulations-2020",
        name: "Electricity Safety (Electric Line Clearance) Regulations 2020",
        collection: "statutory-rules",
        aliases: ["electric line clearance regulations"],
    },
    {
        slug: "electricity-safety-installations-regulations-2009",
        name: "Electricity Safety (Installations) Regulations 2009",
        collection: "statutory-rules",
        aliases: ["electricity safety installations regulations"],
    },
    {
        slug: "electricity-safety-management-regulations-2019",
        name: "Electricity Safety (Management) Regulations 2019",
        collection: "statutory-rules",
        aliases: ["electricity safety management regulations"],
    },
    {
        slug: "gas-safety-gas-installation-regulations-2018",
        name: "Gas Safety (Gas Installation) Regulations 2018",
        collection: "statutory-rules",
        aliases: ["gas installation regulations"],
    },
    {
        slug: "gas-safety-safety-case-regulations-2018",
        name: "Gas Safety (Safety Case) Regulations 2018",
        collection: "statutory-rules",
        aliases: ["gas safety case regulations"],
    },
    {
        slug: "victorian-energy-efficiency-target-regulations-2018",
        name: "Victorian Energy Efficiency Target Regulations 2018",
        collection: "statutory-rules",
        aliases: ["veet regulations"],
    },
];

function request(
    fetchImpl: VicFetch,
    url: string,
    init: RequestInit = {},
): Promise<Response> {
    return fetchImpl(url, {
        ...init,
        headers: {
            Accept: "application/json, application/pdf, text/html, */*",
            "User-Agent": USER_AGENT,
            ...(init.headers ?? {}),
        },
    });
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

export function slugifyVicTitle(query: string): string {
    return query
        .trim()
        .toLowerCase()
        .replace(/^vic:/, "")
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function vicTitleId(slug: string, collection: VicCollection = "acts"): string {
    return `vic:${collection === "acts" ? "" : "sr:"}${slug}`.replace(
        "vic:sr:",
        "vic:sr:",
    );
}

export function parseVicTitleId(id: string): {
    slug: string;
    collection: VicCollection;
} | null {
    const raw = id.trim().toLowerCase().replace(/^vic:/, "");
    if (!raw) return null;
    if (raw.startsWith("sr:")) {
        return { slug: raw.slice(3), collection: "statutory-rules" };
    }
    return { slug: raw, collection: "acts" };
}

export function parseActNumber(meta: string[]): {
    number: string | null;
    year: number | null;
} {
    for (const line of meta) {
        const match = line.match(NUMBER_RE);
        if (match) {
            return { number: match[1], year: Number(match[2]) };
        }
    }
    return { number: null, year: null };
}

export function authorisedFileUrl(args: {
    year: number;
    number: string;
    version: string;
    start: string;
}): string {
    const yy = String(args.year).slice(-2).padStart(2, "0");
    const month = args.start.slice(0, 7);
    const version = args.version.replace(/^0+/, "") || "0";
    return `${FILES}/${month}/${yy}-${args.number}aa${version.padStart(3, "0")}-authorised.pdf`;
}

export function parseVicPage(payload: unknown): {
    title: VicTitle;
    versions: VicVersion[];
} | null {
    const root = asRecord(payload);
    if (!root) return null;
    const header = asRecord(root.header);
    const meta = asRecord(root.meta);
    const path =
        typeof meta?.url === "string"
            ? meta.url
            : typeof root.title === "string"
              ? ""
              : "";
    const name =
        (typeof header?.title === "string" && header.title) ||
        (typeof root.title === "string" && root.title) ||
        "";
    if (!name || !path.includes("/in-force/")) return null;
    const collection: VicCollection = path.includes("/statutory-rules/")
        ? "statutory-rules"
        : "acts";
    const slug = path.split("/").filter(Boolean).at(-1) ?? slugifyVicTitle(name);
    const parsedNumber = parseActNumber(
        asArray(header?.meta).filter((row): row is string => typeof row === "string"),
    );
    const title: VicTitle = {
        id: `vic:${collection === "statutory-rules" ? "sr:" : ""}${slug}`,
        slug,
        name,
        collection,
        number: parsedNumber.number,
        year: parsedNumber.year,
        url: `${WEB}${path}`,
    };
    const versions: VicVersion[] = asArray(root.versions)
        .map((row) => {
            const record = asRecord(row);
            if (!record) return null;
            const version =
                typeof record.version === "string" ? record.version : null;
            const start =
                typeof record.date === "string" ? record.date.slice(0, 10) : null;
            const url = typeof record.url === "string" ? record.url : null;
            if (!version || !start || !url) return null;
            const fileUrl =
                title.year && title.number
                    ? authorisedFileUrl({
                          year: title.year,
                          number: title.number,
                          version,
                          start,
                      })
                    : null;
            return {
                titleId: title.id,
                label: `version ${version}`,
                start,
                end: null,
                isLatest: /in force/i.test(String(record.status ?? "")),
                url: `${WEB}${url}`,
                fileUrl,
            } satisfies VicVersion;
        })
        .filter((row): row is NonNullable<typeof row> => row != null);
    versions.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
    if (versions[0]) versions[0].isLatest = true;
    for (let i = 1; i < versions.length; i++) {
        const next = versions[i - 1]?.start;
        versions[i].end = next ? previousStartMinusOne(next) : versions[i].end;
        versions[i].isLatest = false;
    }
    return { title, versions };
}

function previousStartMinusOne(start: string): string | null {
    if (!DATE_RE.test(start)) return null;
    const date = new Date(`${start}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
}

export function selectVicVersionAsAt(
    versions: VicVersion[],
    asAt: string,
): VicVersion | null {
    if (!DATE_RE.test(asAt)) {
        throw new AuVicError("date must be yyyy-mm-dd");
    }
    return (
        versions.find(
            (version) =>
                version.start <= asAt && (!version.end || asAt <= version.end),
        ) ?? null
    );
}

export function searchKnownVicTitles(query: string, limit = 10): VicTitle[] {
    const needle = query.trim().toLowerCase().replace(/^vic:/, "");
    if (!needle) {
        return KNOWN.slice(0, limit).map(knownTitle);
    }
    const scored = KNOWN.map((row) => {
        const haystack = [row.slug, row.name, ...row.aliases].join(" ").toLowerCase();
        const exact =
            row.slug === needle ||
            row.name.toLowerCase() === needle ||
            row.aliases.includes(needle);
        return {
            row,
            score: exact ? 0 : haystack.includes(needle) ? 1 : 99,
        };
    })
        .filter((row) => row.score < 99)
        .sort((a, b) => a.score - b.score);
    return scored.slice(0, Math.max(1, Math.min(limit, 40))).map((row) =>
        knownTitle(row.row),
    );
}

function knownTitle(row: (typeof KNOWN)[number]): VicTitle {
    return {
        id: `vic:${row.collection === "statutory-rules" ? "sr:" : ""}${row.slug}`,
        slug: row.slug,
        name: row.name,
        collection: row.collection,
        number: null,
        year: null,
        url: `${WEB}/in-force/${row.collection}/${row.slug}`,
    };
}

const LISTING_HREF_RE =
    /href="(\/in-force\/(acts|statutory-rules)\/[a-z0-9-]+)"[^>]*>([^<]{4,160})</gi;

export function parseVicListing(payload: unknown): VicTitle[] {
    const titles: VicTitle[] = [];
    const seen = new Set<string>();
    const add = (path: string, name: string) => {
        const collection: VicCollection = path.includes("/statutory-rules/")
            ? "statutory-rules"
            : "acts";
        const slug = path.split("/").filter(Boolean).at(-1) ?? "";
        if (!slug || seen.has(`${collection}:${slug}`)) return;
        seen.add(`${collection}:${slug}`);
        titles.push({
            id: `vic:${collection === "statutory-rules" ? "sr:" : ""}${slug}`,
            slug,
            name: name.replace(/\s+/g, " ").trim() || slug,
            collection,
            number: null,
            year: null,
            url: `${WEB}${path}`,
        });
    };
    const walk = (value: unknown): void => {
        if (typeof value === "string") {
            LISTING_HREF_RE.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = LISTING_HREF_RE.exec(value))) {
                add(match[1], match[3]);
            }
            return;
        }
        if (Array.isArray(value)) {
            for (const row of value) walk(row);
            return;
        }
        const record = asRecord(value);
        if (!record) return;
        const path =
            typeof record.url === "string"
                ? record.url
                : typeof record.path === "string"
                  ? record.path
                  : "";
        const name =
            (typeof record.title === "string" && record.title) ||
            (typeof record.name === "string" && record.name) ||
            "";
        if (path.includes("/in-force/") && name) add(path, name);
        for (const child of Object.values(record)) walk(child);
    };
    walk(payload);
    return titles;
}

async function readTidePage(
    path: string,
    options: VicOptions,
): Promise<unknown> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await request(
        fetchImpl,
        `${TIDE}?path=${encodeURIComponent(path)}`,
    );
    if (response.status === 429) {
        throw new AuVicError(
            "Victorian legislation rate-limited this request. Stop further Victorian legislation calls this turn.",
            429,
        );
    }
    if (response.status === 404) return null;
    if (!response.ok) {
        throw new AuVicError(
            `Victorian legislation request failed (${response.status}).`,
            response.status,
        );
    }
    return response.json();
}

export async function getVicTitle(
    query: string,
    options: VicOptions = {},
): Promise<{ title: VicTitle; versions: VicVersion[] } | null> {
    const parsed = parseVicTitleId(query) ?? {
        slug: slugifyVicTitle(query),
        collection: "acts" as const,
    };
    const known = KNOWN.find(
        (row) =>
            row.slug === parsed.slug ||
            row.aliases.includes(query.trim().toLowerCase()),
    );
    const collection = known?.collection ?? parsed.collection;
    const slug = known?.slug ?? parsed.slug;
    const payload = await readTidePage(
        `/in-force/${collection}/${slug}`,
        options,
    );
    return payload ? parseVicPage(payload) : null;
}

let listingCache: { at: number; titles: VicTitle[] } | null = null;

async function listInForceVicTitles(options: VicOptions): Promise<VicTitle[]> {
    if (listingCache && Date.now() - listingCache.at < 6 * 60 * 60 * 1000) {
        return listingCache.titles;
    }
    const titles: VicTitle[] = [];
    for (const collection of ["acts", "statutory-rules"] as const) {
        const payload = await readTidePage(`/in-force/${collection}`, options);
        if (payload) titles.push(...parseVicListing(payload));
    }
    listingCache = { at: Date.now(), titles };
    return titles;
}

export function searchListedVicTitles(
    titles: VicTitle[],
    query: string,
    limit = 10,
): VicTitle[] {
    const needle = query.trim().toLowerCase().replace(/^vic:(?:sr:)?/, "");
    if (!needle) return titles.slice(0, limit);
    return titles
        .filter((title) => {
            const haystack = `${title.slug} ${title.name}`.toLowerCase();
            return haystack.includes(needle) || title.id.toLowerCase() === query.trim().toLowerCase();
        })
        .slice(0, Math.max(1, Math.min(limit, 40)));
}

export async function searchVicLegislation(
    query: string,
    options: VicOptions & { limit?: number } = {},
): Promise<VicTitle[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 10, 40));
    const live = await getVicTitle(query, options);
    if (live) return [live.title];
    const known = searchKnownVicTitles(query, limit);
    if (known.length) return known;
    try {
        return searchListedVicTitles(await listInForceVicTitles(options), query, limit);
    } catch {
        return [];
    }
}

export async function listVicVersions(
    titleId: string,
    options: VicOptions = {},
): Promise<{ title: VicTitle; versions: VicVersion[] }> {
    const live = await getVicTitle(titleId, options);
    if (!live?.versions.length) {
        throw new AuVicError(
            `"${titleId}" was not found on legislation.vic.gov.au. Search first.`,
        );
    }
    return live;
}

export function findVicSection(
    text: string,
    section?: string | null,
    page = 1,
): { text: string; section: string | null; page: number; pageCount: number } {
    const pageSize = 7000;
    if (!section?.trim()) {
        const pageCount = Math.max(1, Math.ceil(text.length / pageSize));
        const safePage = Math.min(Math.max(page, 1), pageCount);
        const start = (safePage - 1) * pageSize;
        return {
            text: text.slice(start, start + pageSize),
            section: null,
            page: safePage,
            pageCount,
        };
    }
    const wanted = section.trim().replace(/^s(?:ection)?\s+/i, "");
    const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const heading = new RegExp(
        `(^|\\n)\\s*(?:section\\s+)?${escaped}\\b[\\s\\S]*?(?=\\n\\s*(?:section\\s+)?(?!${escaped}\\b)\\d+[A-Za-z]?(?:\\.\\d+)*\\s+[A-Za-z]|$)`,
        "i",
    );
    const match = text.match(heading);
    if (!match) {
        throw new AuVicError(
            `Section ${wanted} was not found in the fetched Victorian title.`,
        );
    }
    return {
        text: match[0].trim(),
        section: wanted,
        page: 1,
        pageCount: 1,
    };
}

export async function getVicLegislationText(
    titleId: string,
    options: VicOptions & {
        asAt?: string;
        section?: string;
        page?: number;
    } = {},
): Promise<VicText> {
    const { title, versions } = await listVicVersions(titleId, options);
    const version = options.asAt
        ? selectVicVersionAsAt(versions, options.asAt)
        : versions[0];
    if (!version) {
        throw new AuVicError(`No ${title.name} version covers ${options.asAt}.`);
    }
    if (!version.fileUrl) {
        throw new AuVicError(
            `No authorised file URL could be built for ${title.name} ${version.label}.`,
        );
    }
    const fetchImpl = options.fetchImpl ?? fetch;
    const downloaded = await fetchOfficialBytes(
        (url, init) => request(fetchImpl, url, init),
        version.fileUrl,
        {},
        cacheForInjectedFetch(options.fetchImpl, options.cache),
    );
    if (downloaded.status !== 200) {
        throw new AuVicError(
            `Could not download the authorised ${title.name} ${version.label}.`,
            downloaded.status,
        );
    }
    const bytes = downloaded.bytes;
    const view = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const extract = options.extractPdf ?? extractPdfText;
    const fullText = await extract(view);
    const found = findVicSection(fullText, options.section, options.page);
    devLog("[au-vic] get", {
        id: title.id,
        version: version.label,
        section: options.section ?? null,
    });
    return {
        titleId: title.id,
        name: title.name,
        asAt: version.isLatest ? null : version.start,
        versionLabel: version.label,
        start: version.start,
        end: version.end,
        url: version.fileUrl,
        ...found,
        attribution:
            "Legislative material © State of Victoria, sourced from legislation.vic.gov.au.",
    };
}
