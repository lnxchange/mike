import { mapWithConcurrency } from "./concurrency";
import { extractDocxBodyText } from "./docxTrackedChanges";
import { fetchExaContents, type ExaContentsFetch } from "./exaContents";
import {
    resolveLegalSourceText,
    type LegalSourceStore,
} from "./legalSourceStore";
import {
    cacheForInjectedFetch,
    fetchOfficialBytes,
    type OfficialFileCache,
} from "./officialFileCache";
import {
    looksLikeBotChallenge,
    officialSourceUnavailableMessage,
    type OfficialSourceKind,
} from "./officialSourceAccess";
import { extractPdfText } from "./pdfText";
import { devLog } from "./log";

/** AEMC books larger than this are not snapshotted into the shelf. */
export const AEMC_SNAPSHOT_MAX_NODES = 500;

const ESC_ORIGIN = "https://www.esc.vic.gov.au";
const AEMC_API = "https://energy-rules.aemc.gov.au/api/v1";
const AEMC_WEB = "https://energy-rules.aemc.gov.au";
const USER_AGENT = "mike-legal-assistant (https://github.com/lnxchange/mike)";
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const VERSION_RE = /version\s*([0-9]+[a-z]?)/i;
const ISO_FROM_NAME_RE = /(20\d{2})(\d{2})(\d{2})/;
const MONTHS: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
};

export class AuEnergyError extends Error {
    status?: number;
    kind?: OfficialSourceKind;
    officialUrl?: string;

    constructor(message: string, status?: number) {
        super(message);
        this.name = "AuEnergyError";
        this.status = status;
    }
}

function unavailableEnergyDownload(
    instrument: EnergyInstrument,
    status?: number,
): AuEnergyError {
    const err = new AuEnergyError(
        officialSourceUnavailableMessage({
            name: instrument.name,
            site: new URL(instrument.landingUrl).hostname,
        }),
        status,
    );
    err.kind = "unavailable";
    err.officialUrl = instrument.landingUrl;
    return err;
}

export type EnergyFetch = (
    input: string,
    init?: RequestInit,
) => Promise<Response>;

export type EnergySource =
    | "esc"
    | "aemc"
    | "aer"
    | "aemo"
    | "sa"
    | "nsw"
    | "qld"
    | "act";

export type EnergyInstrument = {
    id: string;
    name: string;
    aliases: string[];
    publisher: string;
    jurisdiction: string;
    landingUrl: string;
    source: EnergySource;
    aemcType?: "ner" | "ngr" | "nerr";
    fileUrl?: string;
};

export type EnergyVersion = {
    instrumentId: string;
    label: string;
    start: string;
    end: string | null;
    isLatest: boolean;
    url: string;
    downloadUrl?: string | null;
    aemcVersionId?: number;
};

export type EnergyText = {
    instrumentId: string;
    name: string;
    asAt: string | null;
    versionLabel: string | null;
    start: string | null;
    end: string | null;
    url: string;
    clause: string | null;
    page: number;
    pageCount: number;
    text: string;
    attribution: string;
    retrievedVia?: "official" | "exa" | "store" | "upload";
    currencyStatus?: "current" | "unconfirmed";
};

export const ENERGY_INSTRUMENTS: EnergyInstrument[] = [
    {
        id: "esc:ercop",
        name: "Energy Retail Code of Practice",
        aliases: [
            "ercop",
            "energy retail code",
            "victorian energy retail code",
            "retail code of practice",
        ],
        publisher: "Essential Services Commission",
        jurisdiction: "Victoria",
        landingUrl:
            "https://www.esc.vic.gov.au/electricity-and-gas/codes-guidelines-and-policies/energy-retail-code-practice",
        source: "esc",
    },
    {
        id: "esc:edcop",
        name: "Electricity Distribution Code of Practice",
        aliases: [
            "edcop",
            "electricity distribution code",
            "victorian electricity distribution code",
        ],
        publisher: "Essential Services Commission",
        jurisdiction: "Victoria",
        landingUrl:
            "https://www.esc.vic.gov.au/electricity-and-gas/codes-guidelines-and-policies/electricity-distribution-code-practice",
        source: "esc",
    },
    {
        id: "esc:gdcop",
        name: "Gas Distribution Code of Practice",
        aliases: [
            "gdcop",
            "gas distribution code",
            "victorian gas distribution code",
        ],
        publisher: "Essential Services Commission",
        jurisdiction: "Victoria",
        landingUrl:
            "https://www.esc.vic.gov.au/electricity-and-gas/codes-guidelines-and-policies/gas-distribution-code-practice",
        source: "esc",
    },
    {
        id: "aemc:nerr",
        name: "National Energy Retail Rules",
        aliases: [
            "nerr",
            "national energy retail rules",
            "energy retail rules",
            "retail rules",
            "national energy retail law rules",
        ],
        publisher: "Australian Energy Market Commission",
        jurisdiction: "National",
        landingUrl: `${AEMC_WEB}/nerr`,
        source: "aemc",
        aemcType: "nerr",
    },
    {
        id: "aemc:ner",
        name: "National Electricity Rules",
        aliases: ["ner", "national electricity rules"],
        publisher: "Australian Energy Market Commission",
        jurisdiction: "National",
        landingUrl: `${AEMC_WEB}/ner`,
        source: "aemc",
        aemcType: "ner",
    },
    {
        id: "aemc:ngr",
        name: "National Gas Rules",
        aliases: ["ngr", "national gas rules"],
        publisher: "Australian Energy Market Commission",
        jurisdiction: "National",
        landingUrl: `${AEMC_WEB}/ngr`,
        source: "aemc",
        aemcType: "ngr",
    },
    {
        id: "aer:retail-compliance",
        name: "AER Retail Compliance Procedures and Guidelines",
        aliases: [
            "retail compliance procedures",
            "aer compliance procedures",
            "retail law compliance guidelines",
        ],
        publisher: "Australian Energy Regulator",
        jurisdiction: "National",
        landingUrl: "https://www.aer.gov.au/industry/retail/guidelines",
        source: "aer",
        fileUrl:
            "https://www.aer.gov.au/system/files/2024-07/Final%20%28Retail%20Law%29%20Compliance%20procedures%20and%20guidelines.pdf",
    },
    {
        id: "aer:ring-fencing-ed",
        name: "AER Ring-fencing Guideline (Electricity Distribution)",
        aliases: [
            "ring-fencing guideline",
            "ring fencing electricity distribution",
            "electricity distribution ring-fencing",
        ],
        publisher: "Australian Energy Regulator",
        jurisdiction: "National",
        landingUrl:
            "https://www.aer.gov.au/industry/networks/ring-fencing/ring-fencing-guideline-electricity-distribution",
        source: "aer",
        fileUrl:
            "https://www.aer.gov.au/system/files/2025-02/Ring-fencing%20guideline%20%28electricity%20distribution%29%20version%204_0.pdf",
    },
    {
        id: "aer:cba",
        name: "AER Cost Benefit Analysis Guidelines",
        aliases: [
            "cost benefit analysis guidelines",
            "cba guidelines",
            "isp cost benefit",
        ],
        publisher: "Australian Energy Regulator",
        jurisdiction: "National",
        landingUrl:
            "https://www.aer.gov.au/industry/registers/resources/guidelines/cost-benefit-analysis-guidelines",
        source: "aer",
        fileUrl:
            "https://www.aer.gov.au/system/files/2025-05/AER%20-%20Cost%20Benefit%20Analysis%20guidelines%20-%202024%20-%20Version%203%20with%20mark%20up.pdf",
    },
    {
        id: "aer:exempt-selling",
        name: "AER Retail Exempt Selling Guideline",
        aliases: [
            "exempt selling guideline",
            "retail exempt selling",
            "exempt seller",
        ],
        publisher: "Australian Energy Regulator",
        jurisdiction: "National",
        landingUrl:
            "https://www.aer.gov.au/industry/retail/guidelines",
        source: "aer",
        fileUrl:
            "https://www.aer.gov.au/documents/aer-retail-exempt-selling-guideline-version-6-july-2022",
    },
    {
        id: "aemo:b2b",
        name: "AEMO Business-to-business Procedures",
        aliases: [
            "b2b procedures",
            "aemo b2b",
            "business to business procedures",
        ],
        publisher: "Australian Energy Market Operator",
        jurisdiction: "National",
        landingUrl:
            "https://www.aemo.com.au/energy-systems/electricity/national-electricity-market-nem/market-operations/retail-and-metering/business-to-business-procedures",
        source: "aemo",
    },
    {
        id: "aemo:psop",
        name: "AEMO Power System Operating Procedures",
        aliases: [
            "power system operating procedures",
            "so_op",
            "system operating procedures",
        ],
        publisher: "Australian Energy Market Operator",
        jurisdiction: "National",
        landingUrl:
            "https://www.aemo.com.au/energy-systems/electricity/national-electricity-market-nem/system-operations/power-system-operation/power-system-operating-procedures",
        source: "aemo",
    },
    {
        id: "esc:vdo",
        name: "Victorian Default Offer",
        aliases: [
            "vdo",
            "victorian default offer",
            "default offer victoria",
            "standing offer victoria",
        ],
        publisher: "Essential Services Commission",
        jurisdiction: "Victoria",
        landingUrl:
            "https://www.esc.vic.gov.au/electricity-and-gas/prices-tariffs-and-benchmarks/victorian-default-offer",
        source: "esc",
        fileUrl:
            "https://www.esc.vic.gov.au/sites/default/files/documents/Victorian%20Default%20Offer%202026-27%20Price%20Determination.pdf",
    },
    {
        id: "esc:cprg",
        name: "Compliance and Performance Reporting Guideline",
        aliases: [
            "cprg",
            "compliance and performance reporting",
            "esc compliance guideline",
            "victorian compliance reporting guideline",
        ],
        publisher: "Essential Services Commission",
        jurisdiction: "Victoria",
        landingUrl:
            "https://www.esc.vic.gov.au/electricity-and-gas/codes-guidelines-and-policies/compliance-and-performance-reporting-guideline",
        source: "esc",
        fileUrl:
            "https://www.esc.vic.gov.au/sites/default/files/documents/Compliance%20and%20Performance%20Reporting%20Guideline%20%28version%209%29.pdf",
    },
    {
        id: "aer:hardship",
        name: "AER Customer Hardship Policy Guideline",
        aliases: [
            "hardship guideline",
            "customer hardship policy guideline",
            "aer hardship",
        ],
        publisher: "Australian Energy Regulator",
        jurisdiction: "National",
        landingUrl: "https://www.aer.gov.au/industry/retail/guidelines",
        source: "aer",
        fileUrl:
            "https://www.aer.gov.au/system/files/2025-02/AER%20-%20Customer%20Hardship%20Policy%20Guideline%20March%202019.pdf",
    },
    {
        id: "aer:better-bills",
        name: "AER Better Bills Guideline",
        aliases: [
            "better bills guideline",
            "billing guideline",
            "aer better bills",
        ],
        publisher: "Australian Energy Regulator",
        jurisdiction: "National",
        landingUrl: "https://www.aer.gov.au/industry/retail/guidelines",
        source: "aer",
        fileUrl:
            "https://www.aer.gov.au/system/files/AER%20-%20Better%20Bills%20Guideline%20%28Version%202%29%20-%20January%202023_0.pdf",
    },
    {
        id: "aer:retailer-authorisation",
        name: "AER Retailer Authorisation Guideline",
        aliases: [
            "retailer authorisation guideline",
            "authorisation guideline",
            "aer authorisation",
        ],
        publisher: "Australian Energy Regulator",
        jurisdiction: "National",
        landingUrl: "https://www.aer.gov.au/industry/retail/guidelines",
        source: "aer",
        fileUrl:
            "https://www.aer.gov.au/system/files/2024-07/AER%20-%20Retailer%20authorisation%20guideline%20-%20July%202024.pdf",
    },
    {
        id: "aer:rpig",
        name: "AER Retail Pricing Information Guidelines",
        aliases: [
            "retail pricing information guidelines",
            "rpig",
            "basic plan information",
            "energy price fact sheet",
        ],
        publisher: "Australian Energy Regulator",
        jurisdiction: "National",
        landingUrl: "https://www.aer.gov.au/industry/retail/guidelines",
        source: "aer",
        fileUrl:
            "https://www.aer.gov.au/system/files/AER%20Retail%20Pricing%20Information%20Guidelines%20-%20Version%205.0%20-%20April%202018.pdf",
    },
    {
        id: "aer:dmo",
        name: "AER Default Market Offer",
        aliases: [
            "dmo",
            "default market offer",
            "dmo 8",
            "default market offer prices",
        ],
        publisher: "Australian Energy Regulator",
        jurisdiction: "National",
        landingUrl:
            "https://www.aer.gov.au/industry/registers/resources/reviews/default-market-offer-prices-2026-27",
        source: "aer",
        fileUrl:
            "https://www.aer.gov.au/system/files/2026-05/AER%20-%20Final%20determination%20-%20Default%20market%20offer%202026%E2%80%9327.pdf",
    },
    {
        id: "aemo:msats",
        name: "AEMO MSATS Procedures",
        aliases: [
            "msats",
            "msats procedures",
            "cats procedures",
            "market settlement and transfer solutions",
        ],
        publisher: "Australian Energy Market Operator",
        jurisdiction: "National",
        landingUrl:
            "https://www.aemo.com.au/energy-systems/electricity/national-electricity-market-nem/market-operations/retail-and-metering/market-settlement-and-transfer-solutions-msats",
        source: "aemo",
    },
    {
        id: "aemo:metering",
        name: "AEMO Retail and Metering Procedures",
        aliases: [
            "metering procedures",
            "retail and metering procedures",
            "aemo metering",
            "service level procedures",
        ],
        publisher: "Australian Energy Market Operator",
        jurisdiction: "National",
        landingUrl:
            "https://www.aemo.com.au/energy-systems/electricity/national-electricity-market-nem/market-operations/retail-and-metering",
        source: "aemo",
    },
    {
        id: "sa:nerl",
        name: "National Energy Retail Law",
        aliases: [
            "nerl",
            "national energy retail law",
            "retail law",
            "national energy retail law south australia",
        ],
        publisher: "South Australian Parliament",
        jurisdiction: "National",
        landingUrl:
            "https://www.legislation.sa.gov.au/lz?path=%2FC%2FA%2FNATIONAL%20ENERGY%20RETAIL%20LAW%20(SOUTH%20AUSTRALIA)%20ACT%202011",
        source: "sa",
        fileUrl:
            "https://www.legislation.sa.gov.au/__legislation/lz/c/a/national%20energy%20retail%20law%20(south%20australia)%20act%202011/current/2011.6.auth.pdf",
    },
    {
        id: "sa:nel",
        name: "National Electricity Law",
        aliases: [
            "nel",
            "national electricity law",
            "national electricity south australia act",
        ],
        publisher: "South Australian Parliament",
        jurisdiction: "National",
        landingUrl:
            "https://www.legislation.sa.gov.au/lz?path=%2FC%2FA%2FNATIONAL%20ELECTRICITY%20(SOUTH%20AUSTRALIA)%20ACT%201996",
        source: "sa",
        fileUrl:
            "https://www.legislation.sa.gov.au/__legislation/lz/c/a/national%20electricity%20(south%20australia)%20act%201996/current/1996.44.auth.pdf",
    },
    {
        id: "sa:ngl",
        name: "National Gas Law",
        aliases: [
            "ngl",
            "national gas law",
            "national gas south australia act",
        ],
        publisher: "South Australian Parliament",
        jurisdiction: "National",
        landingUrl:
            "https://www.legislation.sa.gov.au/lz?path=%2FC%2FA%2FNATIONAL%20GAS%20(SOUTH%20AUSTRALIA)%20ACT%202008",
        source: "sa",
        fileUrl:
            "https://www.legislation.sa.gov.au/__legislation/lz/c/a/national%20gas%20(south%20australia)%20act%202008/current/2008.19.auth.pdf",
    },
    {
        id: "nsw:nerl-adoption",
        name: "National Energy Retail Law (Adoption) Act 2012 (NSW)",
        aliases: [
            "nerl adoption",
            "national energy retail law adoption act",
            "nsw nerl",
        ],
        publisher: "NSW Parliament",
        jurisdiction: "New South Wales",
        landingUrl:
            "https://legislation.nsw.gov.au/view/html/inforce/current/act-2012-037",
        source: "nsw",
        fileUrl:
            "https://legislation.nsw.gov.au/view/whole/pdf/inforce/current/act-2012-037",
    },
    {
        id: "nsw:nel-adoption",
        name: "National Electricity (New South Wales) Act 1997",
        aliases: [
            "national electricity nsw",
            "nsw nel",
            "national electricity new south wales act",
        ],
        publisher: "NSW Parliament",
        jurisdiction: "New South Wales",
        landingUrl:
            "https://legislation.nsw.gov.au/view/html/inforce/current/act-1997-020",
        source: "nsw",
        fileUrl:
            "https://legislation.nsw.gov.au/view/whole/pdf/inforce/current/act-1997-020",
    },
    {
        id: "nsw:ngl-adoption",
        name: "National Gas (New South Wales) Act 2008",
        aliases: [
            "national gas nsw",
            "nsw ngl",
            "national gas new south wales act",
        ],
        publisher: "NSW Parliament",
        jurisdiction: "New South Wales",
        landingUrl:
            "https://legislation.nsw.gov.au/view/html/inforce/current/act-2008-031",
        source: "nsw",
        fileUrl:
            "https://legislation.nsw.gov.au/view/whole/pdf/inforce/current/act-2008-031",
    },
    {
        id: "qld:nerl-adoption",
        name: "National Energy Retail Law (Queensland) Act 2014",
        aliases: [
            "nerl queensland",
            "qld nerl",
            "national energy retail law queensland",
        ],
        publisher: "Queensland Parliament",
        jurisdiction: "Queensland",
        landingUrl:
            "https://www.legislation.qld.gov.au/view/html/inforce/current/act-2014-049",
        source: "qld",
        fileUrl:
            "https://www.legislation.qld.gov.au/view/pdf/inforce/current/act-2014-049",
    },
    {
        id: "act:nerl-adoption",
        name: "National Energy Retail Law (ACT) Act 2012",
        aliases: ["nerl act", "act nerl", "national energy retail law act"],
        publisher: "ACT Legislative Assembly",
        jurisdiction: "Australian Capital Territory",
        landingUrl: "https://www.legislation.act.gov.au/a/2012-31",
        source: "act",
        fileUrl:
            "https://www.legislation.act.gov.au/DownloadFile/a/2012-31/current/PDF/2012-31.PDF",
    },
];

const INSTRUMENT_BY_ID = new Map(
    ENERGY_INSTRUMENTS.map((instrument) => [instrument.id, instrument]),
);

type EnergyOptions = {
    fetchImpl?: EnergyFetch;
    extractDocx?: (bytes: Buffer) => Promise<string>;
    extractPdf?: (bytes: ArrayBuffer) => Promise<string>;
    cache?: OfficialFileCache;
    store?: LegalSourceStore;
    exaFetch?: ExaContentsFetch;
    /** Fetch every AEMC TOC node and store the concatenated book. */
    fullSnapshot?: boolean;
    /** Return the whole instrument instead of a clause or page. */
    returnFullText?: boolean;
};

function defaultFetch(input: string, init?: RequestInit): Promise<Response> {
    return fetch(input, init);
}

function request(
    fetchImpl: EnergyFetch,
    url: string,
    init: RequestInit = {},
): Promise<Response> {
    return fetchImpl(url, {
        ...init,
        headers: {
            Accept: "application/json, text/html, */*",
            "User-Agent": USER_AGENT,
            ...(init.headers ?? {}),
        },
    });
}

function assertDate(value: string): string {
    if (!DATE_RE.test(value)) {
        throw new AuEnergyError("date must be yyyy-mm-dd");
    }
    return value;
}

export function resolveEnergyInstrument(query: string): EnergyInstrument | null {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    const exact = INSTRUMENT_BY_ID.get(needle);
    if (exact) return exact;
    return (
        ENERGY_INSTRUMENTS.find(
            (instrument) =>
                instrument.id === needle ||
                instrument.name.toLowerCase() === needle ||
                instrument.aliases.some((alias) => alias === needle),
        ) ??
        ENERGY_INSTRUMENTS.find(
            (instrument) =>
                instrument.name.toLowerCase().includes(needle) ||
                instrument.aliases.some((alias) => alias.includes(needle)) ||
                needle.includes(instrument.name.toLowerCase()) ||
                instrument.aliases.some((alias) => needle.includes(alias)),
        ) ??
        null
    );
}

export function searchEnergyInstruments(
    query: string,
    limit = 10,
): EnergyInstrument[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return ENERGY_INSTRUMENTS.slice(0, limit);
    const scored = ENERGY_INSTRUMENTS.map((instrument) => {
        const name = instrument.name.toLowerCase();
        const aliases = instrument.aliases.map((alias) => alias.toLowerCase());
        const haystack = [
            instrument.id,
            name,
            instrument.jurisdiction,
            instrument.publisher,
            ...aliases,
        ].join(" ");
        const exact =
            instrument.id === needle ||
            name === needle ||
            aliases.includes(needle);
        const contained =
            haystack.includes(needle) ||
            needle.includes(name) ||
            aliases.some((alias) => alias.length > 4 && needle.includes(alias));
        return {
            instrument,
            score: exact ? 0 : contained ? 1 : 99,
        };
    })
        .filter((row) => row.score < 99)
        .sort((a, b) => a.score - b.score);
    return scored.slice(0, Math.max(1, Math.min(limit, 50))).map((row) => row.instrument);
}

export function parseEscVersions(
    html: string,
    instrument: EnergyInstrument,
): EnergyVersion[] {
    const versions: EnergyVersion[] = [];
    const seen = new Set<string>();
    const hrefRe =
        /href="(https?:\/\/www\.esc\.vic\.gov\.au\/sites\/default\/files\/documents\/[^"]+\.(?:docx|pdf))"/gi;
    let match: RegExpExecArray | null;
    while ((match = hrefRe.exec(html))) {
        const url = match[1];
        const decoded = decodeURIComponent(url);
        if (!isEscInstrumentFile(decoded, instrument)) continue;
        const before = html.slice(Math.max(0, match.index - 220), match.index);
        const labelMatch = decoded.match(VERSION_RE) ?? before.match(VERSION_RE);
        const label = labelMatch
            ? `version ${labelMatch[1]}`
            : filenameLabel(decoded);
        const start =
            parseFilenameDate(decoded) ??
            parseNearbyDate(before) ??
            "1970-01-01";
        if (seen.has(`${label}:${start}`)) continue;
        seen.add(`${label}:${start}`);
        versions.push({
            instrumentId: instrument.id,
            label,
            start,
            end: null,
            isLatest: versions.length === 0,
            url: instrument.landingUrl,
            downloadUrl: url,
        });
    }
    versions.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
    if (!versions.length && instrument.fileUrl) {
        versions.push({
            instrumentId: instrument.id,
            label: "current",
            start: "1970-01-01",
            end: null,
            isLatest: true,
            url: instrument.landingUrl,
            downloadUrl: instrument.fileUrl,
        });
    }
    return assignVersionWindows(versions);
}

function compactToken(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isEscInstrumentFile(url: string, instrument: EnergyInstrument): boolean {
    const compact = compactToken(url);
    if (
        compact.includes("gasmarket") ||
        compact.includes("amendment") ||
        compact.includes("submission") ||
        compact.includes("consultation")
    ) {
        return false;
    }
    const tokens = [instrument.name, ...instrument.aliases].map(compactToken);
    return tokens.some((token) => token.length > 6 && compact.includes(token));
}

function parseNearbyDate(text: string): string | null {
    const matches = [
        ...text.matchAll(
            /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})/gi,
        ),
    ];
    const match = matches.at(-1);
    if (!match) return null;
    const day = match[1].padStart(2, "0");
    const month = MONTHS[match[2].toLowerCase()];
    return month ? `${match[3]}-${month}-${day}` : null;
}

function parseFilenameDate(name: string): string | null {
    const match = name.match(ISO_FROM_NAME_RE);
    if (!match) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
}

function assignVersionWindows(versions: EnergyVersion[]): EnergyVersion[] {
    return versions.map((version, index) => ({
        ...version,
        isLatest: index === 0,
        end:
            index === 0
                ? null
                : previousStartMinusOne(versions[index - 1]?.start) ?? version.end,
    }));
}

function previousStartMinusOne(start?: string): string | null {
    if (!start || !DATE_RE.test(start)) return null;
    const date = new Date(`${start}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
}

export function selectEnergyVersionAsAt(
    versions: EnergyVersion[],
    asAt: string,
): EnergyVersion | null {
    const date = assertDate(asAt);
    return (
        versions.find(
            (version) =>
                version.start <= date && (!version.end || date <= version.end),
        ) ?? null
    );
}

function stripHtml(value: string): string {
    return value
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

const VERSION_HISTORY_AFTER = new RegExp(
    `^\\s*\\d{1,2}\\s+(January|February|March|April|May|June|July|August|September|October|November|December)\\s+20\\d{2}\\b`,
    "i",
);
const CLAUSE_HEADING =
    /(?:^|\n)\s*(?:clause\s+)?(\d+[A-Za-z]?(?:\.\d+)*)(?!\()(?=\s|[—–-])([^\n]*)/gi;

function isVersionHistoryHeading(afterNumber: string): boolean {
    return VERSION_HISTORY_AFTER.test(afterNumber);
}

function collectEnergyHeadings(
    text: string,
): { index: number; number: string }[] {
    const heading = new RegExp(CLAUSE_HEADING.source, "gi");
    return [...text.matchAll(heading)]
        .filter((match) => !isVersionHistoryHeading(match[2] ?? ""))
        .map((match) => ({
            index: match.index ?? 0,
            number: (match[1] ?? "").toLowerCase(),
        }));
}

export function isEnergyClauseNumber(value: string): boolean {
    return /^\d+[A-Za-z]?(?:\.\d+)*$/.test(value.trim());
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sliceToNextHeading(text: string, from: number, after = from): string {
    const next = collectEnergyHeadings(text).find(
        (heading) => heading.index > after,
    );
    const to = next?.index ?? Math.min(text.length, from + 4000);
    return text.slice(from, to).trim();
}

function findEnergyDefinition(
    text: string,
    phrase: string,
): { text: string; clause: string; page: number; pageCount: number } | null {
    const escaped = escapeRegExp(phrase);
    const re = new RegExp(
        `(^|\\n)[ \\t]*["“”']?${escaped}["“”']?[ \\t]*(?:\\n[ \\t]*)?(?:means|has the (?:same )?meaning|includes)\\b[\\s\\S]{0,1800}`,
        "i",
    );
    const match = re.exec(text);
    if (!match) return null;
    const from = match.index + (match[1] ? match[1].length : 0);
    return {
        text: sliceToNextHeading(text, from, from + phrase.length),
        clause: phrase,
        page: 1,
        pageCount: 1,
    };
}

function findEnergyHeadingPhrase(
    text: string,
    phrase: string,
): { text: string; clause: string; page: number; pageCount: number } | null {
    const compactPhrase = compactToken(phrase);
    if (compactPhrase.length < 4) return null;
    const lines = text.split("\n");
    let offset = 0;
    for (const line of lines) {
        const compactLine = compactToken(line);
        const looksShort = line.trim().length > 0 && line.trim().length <= 90;
        const numbered = /^(?:clause\s+)?\d+[A-Za-z]?(?:\.\d+)*\s+\S/i.test(
            line.trim(),
        );
        if (
            compactLine.includes(compactPhrase) &&
            (looksShort || numbered) &&
            compactLine.length <= compactPhrase.length + 24
        ) {
            const passage = sliceToNextHeading(text, offset, offset + line.length);
            if (passage) {
                return {
                    text: passage,
                    clause: phrase,
                    page: 1,
                    pageCount: 1,
                };
            }
        }
        offset += line.length + 1;
    }
    return null;
}

function findEnergyLoosePhrase(
    text: string,
    phrase: string,
): { text: string; clause: string; page: number; pageCount: number } | null {
    const idx = text.toLowerCase().indexOf(phrase.toLowerCase());
    if (idx < 0) return null;
    const paraStart = text.lastIndexOf("\n\n", idx);
    const from = paraStart >= 0 ? paraStart + 2 : Math.max(0, idx - 200);
    return {
        text: sliceToNextHeading(text, from, idx),
        clause: phrase,
        page: 1,
        pageCount: 1,
    };
}

function findEnergyPhrase(
    text: string,
    phrase: string,
): { text: string; clause: string | null; page: number; pageCount: number } {
    const wanted = phrase.trim();
    const found =
        findEnergyDefinition(text, wanted) ??
        findEnergyHeadingPhrase(text, wanted) ??
        findEnergyLoosePhrase(text, wanted);
    if (found) return found;
    const err = new AuEnergyError(
        `"${wanted}" was not found in the fetched instrument.`,
    );
    err.kind = "not_found";
    throw err;
}

export function findEnergyClause(
    text: string,
    clause?: string | null,
    page = 1,
): { text: string; clause: string | null; page: number; pageCount: number } {
    const pageSize = 7000;
    if (!clause?.trim()) {
        const pageCount = Math.max(1, Math.ceil(text.length / pageSize));
        const safePage = Math.min(Math.max(page, 1), pageCount);
        const start = (safePage - 1) * pageSize;
        return {
            text: text.slice(start, start + pageSize),
            clause: null,
            page: safePage,
            pageCount,
        };
    }
    const wanted = clause.trim().replace(/^cl(?:ause)?\s+/i, "");
    if (!isEnergyClauseNumber(wanted)) {
        return findEnergyPhrase(text, wanted);
    }
    const headings = collectEnergyHeadings(text);
    const startAt = headings.findIndex(
        (heading) => heading.number === wanted.toLowerCase(),
    );
    if (startAt < 0) {
        const err = new AuEnergyError(
            `Clause ${wanted} was not found in the fetched instrument.`,
        );
        err.kind = "not_found";
        throw err;
    }
    const from = headings[startAt]!.index;
    const to = headings[startAt + 1]?.index ?? text.length;
    return {
        text: text.slice(from, to).trim(),
        clause: wanted,
        page: 1,
        pageCount: 1,
    };
}

function attribution(instrument: EnergyInstrument): string {
    if (instrument.source === "esc") {
        return "Victorian energy instrument © Essential Services Commission, sourced from esc.vic.gov.au.";
    }
    if (instrument.source === "aer") {
        return "AER guideline © Commonwealth of Australia, sourced from aer.gov.au.";
    }
    if (instrument.source === "aemo") {
        return "AEMO procedure © Australian Energy Market Operator, sourced from aemo.com.au.";
    }
    if (instrument.source === "sa") {
        return "National energy law © South Australia, sourced from legislation.sa.gov.au.";
    }
    if (instrument.source === "nsw") {
        return "NSW energy application Act © State of New South Wales, sourced from legislation.nsw.gov.au.";
    }
    if (instrument.source === "qld") {
        return "Queensland energy application Act © State of Queensland, sourced from legislation.qld.gov.au.";
    }
    if (instrument.source === "act") {
        return "ACT energy application Act © Australian Capital Territory, sourced from legislation.act.gov.au.";
    }
    return "National energy rules © Australian Energy Market Commission, sourced from energy-rules.aemc.gov.au.";
}

async function readJson(
    fetchImpl: EnergyFetch,
    url: string,
): Promise<unknown> {
    const response = await request(fetchImpl, url);
    if (response.status === 429) {
        const err = new AuEnergyError(
            officialSourceUnavailableMessage({
                name: "this energy instrument",
            }),
            429,
        );
        err.kind = "unavailable";
        throw err;
    }
    if (!response.ok) {
        throw new AuEnergyError(
            `Energy source request failed (${response.status}).`,
            response.status,
        );
    }
    return response.json();
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

export function parseAemcVersions(
    payload: unknown,
    instrument: EnergyInstrument,
): EnergyVersion[] {
    const rows = asArray(asRecord(payload)?.data);
    const versions = rows
        .map((row) => {
            const record = asRecord(row);
            if (!record) return null;
            const id = typeof record.id === "number" ? record.id : null;
            const version =
                typeof record.version === "number" ? String(record.version) : null;
            const start =
                typeof record.start_date === "string"
                    ? record.start_date.slice(0, 10)
                    : typeof record.commencement_date === "string"
                      ? record.commencement_date.slice(0, 10)
                      : null;
            if (!id || !version || !start) return null;
            const end =
                typeof record.end_date === "string"
                    ? record.end_date.slice(0, 10)
                    : null;
            return {
                instrumentId: instrument.id,
                label: `version ${version}`,
                start,
                end,
                isLatest: record.is_current === 1,
                url: `${AEMC_WEB}/${instrument.aemcType}/${id}`,
                aemcVersionId: id,
            } satisfies EnergyVersion;
        })
        .filter((row): row is NonNullable<typeof row> => row != null);
    versions.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
    if (!versions.some((version) => version.isLatest) && versions[0]) {
        versions[0].isLatest = true;
    }
    return versions;
}

type AemcTocNode = {
    id: number;
    title: string;
    index: string;
    children: AemcTocNode[];
};

export function flattenAemcToc(payload: unknown): AemcTocNode[] {
    const walk = (value: unknown): AemcTocNode[] => {
        return asArray(value).flatMap((row) => {
            const record = asRecord(row);
            if (!record || typeof record.id !== "number") return [];
            const node: AemcTocNode = {
                id: record.id,
                title: typeof record.title === "string" ? record.title : "",
                index: typeof record.index === "string" ? record.index : "",
                children: walk(record.children),
            };
            return [node, ...node.children];
        });
    };
    const root = asRecord(payload);
    return walk(root?.data ?? payload);
}

export function findAemcTocNode(
    nodes: AemcTocNode[],
    clause: string,
): AemcTocNode | null {
    const wanted = clause.trim().replace(/^cl(?:ause|r)?\s+/i, "").toLowerCase();
    return (
        nodes.find(
            (node) =>
                node.index.toLowerCase() === wanted ||
                node.title.toLowerCase() === wanted ||
                node.title.toLowerCase().startsWith(`${wanted} `),
        ) ??
        nodes.find(
            (node) =>
                node.index.toLowerCase().startsWith(wanted) ||
                node.title.toLowerCase().includes(wanted),
        ) ??
        null
    );
}

async function listAemcVersions(
    instrument: EnergyInstrument,
    options: EnergyOptions,
    asAt?: string,
): Promise<EnergyVersion[]> {
    if (!instrument.aemcType) {
        throw new AuEnergyError(`${instrument.id} is not an AEMC rule book.`);
    }
    const fetchImpl = options.fetchImpl ?? defaultFetch;
    const params = new URLSearchParams({ perPage: "100" });
    if (asAt) params.set("searchDate", assertDate(asAt));
    const payload = await readJson(
        fetchImpl,
        `${AEMC_API}/rules/${instrument.aemcType}/versions?${params}`,
    );
    const versions = parseAemcVersions(payload, instrument);
    if (!versions.length) {
        throw new AuEnergyError(
            `No published versions were returned for ${instrument.name}.`,
        );
    }
    return versions;
}

async function listEscVersions(
    instrument: EnergyInstrument,
    options: EnergyOptions,
): Promise<EnergyVersion[]> {
    const fetchImpl = options.fetchImpl ?? defaultFetch;
    try {
        const response = await request(fetchImpl, instrument.landingUrl, {
            headers: { Accept: "text/html" },
        });
        if (response.ok) {
            const versions = parseEscVersions(await response.text(), instrument);
            if (versions.length) return versions;
        }
    } catch {
        // Fall through to the curated file when the landing page is slow or down.
    }
    if (instrument.fileUrl) {
        return [
            {
                instrumentId: instrument.id,
                label: "current",
                start: "1970-01-01",
                end: null,
                isLatest: true,
                url: instrument.landingUrl,
                downloadUrl: instrument.fileUrl,
            },
        ];
    }
    throw new AuEnergyError(
        `No official files for ${instrument.name} were found on the official ESC page.`,
    );
}

export function parseRegulatorFiles(
    html: string,
    instrument: EnergyInstrument,
): EnergyVersion[] {
    const versions: EnergyVersion[] = [];
    const seen = new Set<string>();
    const hrefRe =
        /(?:href|src)="((?:https?:\/\/(?:www\.)?(?:aer\.gov\.au|aemo\.com\.au|legislation\.sa\.gov\.au|legislation\.nsw\.gov\.au|legislation\.qld\.gov\.au|legislation\.act\.gov\.au))?[^"]+\.(?:pdf|docx|PDF))"/gi;
    let match: RegExpExecArray | null;
    while ((match = hrefRe.exec(html))) {
        const raw = match[1];
        const host = regulatorHost(instrument);
        const url = raw.startsWith("http")
            ? raw
            : `https://${host}${raw.startsWith("/") ? "" : "/"}${raw}`;
        if (!url.toLowerCase().includes(host.replace(/^www\./, ""))) continue;
        if (seen.has(url)) continue;
        seen.add(url);
        const decoded = decodeURIComponent(url);
        const labelMatch = decoded.match(VERSION_RE);
        const start =
            parseFilenameDate(decoded) ??
            parseNearbyDate(html.slice(Math.max(0, match.index - 220), match.index)) ??
            yearFromPath(decoded) ??
            "1970-01-01";
        versions.push({
            instrumentId: instrument.id,
            label: labelMatch ? `version ${labelMatch[1]}` : filenameLabel(decoded),
            start,
            end: null,
            isLatest: versions.length === 0,
            url: instrument.landingUrl,
            downloadUrl: url,
        });
    }
    if (!versions.length && instrument.fileUrl) {
        versions.push({
            instrumentId: instrument.id,
            label: "current",
            start: "1970-01-01",
            end: null,
            isLatest: true,
            url: instrument.landingUrl,
            downloadUrl: instrument.fileUrl,
        });
    }
    versions.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
    return assignVersionWindows(versions);
}

function filenameLabel(url: string): string {
    const name = url.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "current";
    return decodeURIComponent(name).replace(/[_-]+/g, " ");
}

function yearFromPath(url: string): string | null {
    const match = url.match(/\/(20\d{2})\//);
    return match ? `${match[1]}-01-01` : null;
}

function regulatorHost(instrument: EnergyInstrument): string {
    if (instrument.source === "aer") return "www.aer.gov.au";
    if (instrument.source === "aemo") return "www.aemo.com.au";
    if (instrument.source === "sa") return "www.legislation.sa.gov.au";
    if (instrument.source === "nsw") return "legislation.nsw.gov.au";
    if (instrument.source === "qld") return "www.legislation.qld.gov.au";
    if (instrument.source === "act") return "www.legislation.act.gov.au";
    return "www.esc.vic.gov.au";
}

async function listRegulatorVersions(
    instrument: EnergyInstrument,
    options: EnergyOptions,
): Promise<EnergyVersion[]> {
    const fetchImpl = options.fetchImpl ?? defaultFetch;
    try {
        const response = await request(fetchImpl, instrument.landingUrl, {
            headers: { Accept: "text/html" },
        });
        if (response.ok) {
            const versions = parseRegulatorFiles(await response.text(), instrument);
            if (versions.length) return versions;
        }
    } catch {
        // Fall through to the curated file when the landing page is slow or down.
    }
    if (instrument.fileUrl) {
        return [
            {
                instrumentId: instrument.id,
                label: "current",
                start: "1970-01-01",
                end: null,
                isLatest: true,
                url: instrument.landingUrl,
                downloadUrl: instrument.fileUrl,
            },
        ];
    }
    throw new AuEnergyError(
        `No official files for ${instrument.name} were found on ${instrument.publisher}.`,
    );
}

export async function listEnergyVersions(
    instrumentId: string,
    options: EnergyOptions = {},
): Promise<EnergyVersion[]> {
    const instrument = resolveEnergyInstrument(instrumentId);
    if (!instrument) {
        throw new AuEnergyError(
            `"${instrumentId}" is not a known Australian energy instrument.`,
        );
    }
    if (instrument.source === "aemc") return listAemcVersions(instrument, options);
    if (instrument.source === "esc") return listEscVersions(instrument, options);
    return listRegulatorVersions(instrument, options);
}

function energyExaFetch(options: EnergyOptions): ExaContentsFetch | undefined {
    if (options.exaFetch) return options.exaFetch;
    if (options.fetchImpl) return undefined;
    return fetchExaContents;
}

async function getEscText(
    instrument: EnergyInstrument,
    version: EnergyVersion,
    options: EnergyOptions,
    clause?: string,
    page?: number,
): Promise<EnergyText> {
    const officialUrl = version.downloadUrl ?? instrument.fileUrl ?? instrument.landingUrl;
    if (!version.downloadUrl && !options.store) {
        throw new AuEnergyError(
            `No official file is listed for ${instrument.name} ${version.label}.`,
        );
    }
    const loaded = await resolveLegalSourceText({
        store: options.store,
        family: "energy",
        instrumentId: instrument.id,
        name: instrument.name,
        versionLabel: version.label,
        officialUrl,
        fetchOfficial: async () => {
            if (!version.downloadUrl) {
                throw unavailableEnergyDownload(instrument);
            }
            const fetchImpl = options.fetchImpl ?? defaultFetch;
            let downloaded;
            try {
                downloaded = await fetchOfficialBytes(
                    (url, init) => request(fetchImpl, url, init),
                    version.downloadUrl,
                    {},
                    cacheForInjectedFetch(options.fetchImpl, options.cache),
                );
            } catch (err) {
                if (err instanceof AuEnergyError) throw err;
                throw unavailableEnergyDownload(instrument);
            }
            if (
                downloaded.status !== 200 ||
                looksLikeBotChallenge(downloaded.bytes)
            ) {
                throw unavailableEnergyDownload(instrument, downloaded.status);
            }
            return {
                fullText: await extractEnergyFile(
                    version.downloadUrl,
                    downloaded.bytes,
                    options,
                ),
                officialUrl: version.downloadUrl,
            };
        },
        fetchExa: energyExaFetch(options),
    });
    const found = options.returnFullText
        ? {
              text: loaded.fullText,
              clause: null,
              page: 1,
              pageCount: 1,
          }
        : findEnergyClause(loaded.fullText, clause, page);
    return {
        instrumentId: instrument.id,
        name: instrument.name,
        asAt: version.isLatest ? null : version.start,
        versionLabel: loaded.versionLabel ?? version.label,
        start: version.start,
        end: version.end,
        url: loaded.officialUrl || officialUrl,
        ...found,
        attribution: attribution(instrument),
        retrievedVia: loaded.retrievedVia,
        currencyStatus:
            loaded.currencyStatus === "superseded"
                ? "unconfirmed"
                : loaded.currencyStatus,
    };
}

async function getAemcText(
    instrument: EnergyInstrument,
    version: EnergyVersion,
    options: EnergyOptions,
    clause?: string,
    page?: number,
): Promise<EnergyText> {
    if (!version.aemcVersionId) {
        throw new AuEnergyError(`Missing AEMC version id for ${instrument.name}.`);
    }
    const fetchImpl = options.fetchImpl ?? defaultFetch;
    const toc = flattenAemcToc(
        await readJson(
            fetchImpl,
            `${AEMC_API}/rules/${version.aemcVersionId}/toc`,
        ),
    );
    if (clause) {
        const node = findAemcTocNode(toc, clause);
        if (!node && options.store && !isEnergyClauseNumber(clause)) {
            const held = await options.store.lookupLatest("energy", instrument.id);
            if (held?.fullText) {
                await options.store.touch(held.id);
                const found = findEnergyClause(held.fullText, clause, page);
                return {
                    instrumentId: instrument.id,
                    name: instrument.name,
                    asAt: version.isLatest ? null : version.start,
                    versionLabel: held.versionLabel ?? version.label,
                    start: version.start,
                    end: version.end,
                    url: held.officialUrl || version.url,
                    ...found,
                    attribution: attribution(instrument),
                    retrievedVia: "store",
                    currencyStatus:
                        held.currencyStatus === "superseded"
                            ? "unconfirmed"
                            : held.currencyStatus,
                };
            }
        }
        if (!node) {
            throw new AuEnergyError(
                `Clause ${clause} was not found in ${instrument.name} ${version.label}.`,
            );
        }
        const payload = await readJson(
            fetchImpl,
            `${AEMC_API}/rules/${version.aemcVersionId}/content/${node.id}`,
        );
        const data = asRecord(asRecord(payload)?.data) ?? asRecord(payload);
        const html =
            (typeof data?.content === "string" && data.content) ||
            (typeof data?.description === "string" && data.description) ||
            "";
        const url = `${AEMC_WEB}/${instrument.aemcType}/${version.aemcVersionId}/${node.id}`;
        return {
            instrumentId: instrument.id,
            name: instrument.name,
            asAt: version.isLatest ? null : version.start,
            versionLabel: version.label,
            start: version.start,
            end: version.end,
            url,
            clause: node.index || clause,
            page: 1,
            pageCount: 1,
            text: stripHtml(html) || `${node.index} ${node.title}`.trim(),
            attribution: attribution(instrument),
        };
    }
    const listing = toc
        .slice(0, 40)
        .map((node) => `- ${node.index || node.title}: ${node.title}`)
        .join("\n");
    const found = findEnergyClause(
        `Contents\n${listing}`,
        undefined,
        page,
    );
    return {
        instrumentId: instrument.id,
        name: instrument.name,
        asAt: version.isLatest ? null : version.start,
        versionLabel: version.label,
        start: version.start,
        end: version.end,
        url: version.url,
        ...found,
        attribution: attribution(instrument),
    };
}

export async function getEnergyText(
    instrumentId: string,
    options: EnergyOptions & {
        asAt?: string;
        clause?: string;
        page?: number;
    } = {},
): Promise<EnergyText> {
    const instrument = resolveEnergyInstrument(instrumentId);
    if (!instrument) {
        throw new AuEnergyError(
            `"${instrumentId}" is not a known Australian energy instrument. Search first.`,
        );
    }
    let versions: EnergyVersion[] = [];
    try {
        versions =
            instrument.source === "aemc"
                ? await listAemcVersions(instrument, options, options.asAt)
                : instrument.source === "esc"
                  ? await listEscVersions(instrument, options)
                  : await listRegulatorVersions(instrument, options);
    } catch (err) {
        if (instrument.source === "aemc" || !options.store) throw err;
        const held = await options.store.lookupLatest("energy", instrument.id);
        if (!held) throw err;
        const found = options.returnFullText
            ? {
                  text: held.fullText,
                  clause: null,
                  page: 1,
                  pageCount: 1,
              }
            : findEnergyClause(held.fullText, options.clause, options.page);
        return {
            instrumentId: instrument.id,
            name: instrument.name,
            asAt: options.asAt ?? null,
            versionLabel: held.versionLabel,
            start: null,
            end: null,
            url: held.officialUrl || instrument.landingUrl,
            ...found,
            attribution: attribution(instrument),
            retrievedVia: "store",
            currencyStatus: "unconfirmed",
        };
    }
    const version = options.asAt
        ? selectEnergyVersionAsAt(versions, options.asAt)
        : versions[0];
    if (!version) {
        throw new AuEnergyError(
            `No ${instrument.name} version covers ${options.asAt}.`,
        );
    }
    devLog("[au-energy] get", {
        id: instrument.id,
        version: version.label,
        clause: options.clause ?? null,
    });
    if (instrument.source === "aemc") {
        if (options.fullSnapshot) {
            return getAemcSnapshotText(instrument, version, options);
        }
        return getAemcText(instrument, version, options, options.clause, options.page);
    }
    return getEscText(instrument, version, options, options.clause, options.page);
}

async function getAemcSnapshotText(
    instrument: EnergyInstrument,
    version: EnergyVersion,
    options: EnergyOptions,
): Promise<EnergyText> {
    if (!version.aemcVersionId) {
        throw new AuEnergyError(`Missing AEMC version id for ${instrument.name}.`);
    }
    const fetchImpl = options.fetchImpl ?? defaultFetch;
    const toc = flattenAemcToc(
        await readJson(
            fetchImpl,
            `${AEMC_API}/rules/${version.aemcVersionId}/toc`,
        ),
    );
    if (toc.length > AEMC_SNAPSHOT_MAX_NODES) {
        throw new AuEnergyError(
            `${instrument.name} has ${toc.length} AEMC nodes; snapshot skipped as impractical.`,
        );
    }
    const officialUrl = version.url;
    const loaded = await resolveLegalSourceText({
        store: options.store,
        family: "energy",
        instrumentId: instrument.id,
        name: instrument.name,
        versionLabel: version.label,
        officialUrl,
        fetchOfficial: async () => {
            const parts = await mapWithConcurrency(toc, 5, async (node) => {
                try {
                    const payload = await readJson(
                        fetchImpl,
                        `${AEMC_API}/rules/${version.aemcVersionId}/content/${node.id}`,
                    );
                    const data =
                        asRecord(asRecord(payload)?.data) ?? asRecord(payload);
                    const html =
                        (typeof data?.content === "string" && data.content) ||
                        (typeof data?.description === "string" &&
                            data.description) ||
                        "";
                    const body = stripHtml(html);
                    return body
                        ? `${node.index} ${node.title}\n${body}`.trim()
                        : "";
                } catch {
                    return "";
                }
            });
            const fullText = parts.filter(Boolean).join("\n\n");
            if (!fullText.trim()) {
                throw new AuEnergyError(
                    `No AEMC content was returned for ${instrument.name}.`,
                );
            }
            return { fullText, officialUrl };
        },
        fetchExa: energyExaFetch(options),
    });
    return {
        instrumentId: instrument.id,
        name: instrument.name,
        asAt: version.isLatest ? null : version.start,
        versionLabel: loaded.versionLabel ?? version.label,
        start: version.start,
        end: version.end,
        url: loaded.officialUrl || officialUrl,
        clause: null,
        page: 1,
        pageCount: 1,
        text: loaded.fullText,
        attribution: attribution(instrument),
        retrievedVia: loaded.retrievedVia,
        currencyStatus:
            loaded.currencyStatus === "superseded"
                ? "unconfirmed"
                : loaded.currencyStatus,
    };
}

async function extractEnergyFile(
    url: string,
    bytes: Buffer,
    options: EnergyOptions,
): Promise<string> {
    if (/\.docx(?:$|\?)/i.test(url)) {
        const extract = options.extractDocx ?? extractDocxBodyText;
        return extract(bytes);
    }
    const view = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const extract = options.extractPdf ?? extractPdfText;
    return extract(view);
}
