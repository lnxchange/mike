import { officialSourceUnavailableMessage, type OfficialSourceKind } from "./officialSourceAccess";
import { devLog } from "./log";
import {
    findProvision,
    parseActFromEpub,
    type ActText,
    type FrlProvision,
} from "./frlText";

const FRL_BASE = "https://api.prod.legislation.gov.au/v1";
const FRL_WEB_BASE = "https://www.legislation.gov.au";
const FRL_USER_AGENT = "mike-legal-assistant (https://github.com/lnxchange/mike)";
const TITLE_ID_RE = /^[A-Za-z0-9]+$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const STATUS_NAMES = ["InForce", "Ceased", "Repealed", "NeverEffective"];
const AFFECT_NAMES = [
    "AsMade",
    "Amend",
    "Repeal",
    "Cease",
    "ChangeDate",
    "Disallow",
];

export class FrlError extends Error {
    status?: number;
    kind?: OfficialSourceKind;
    officialUrl?: string;

    constructor(message: string, status?: number) {
        super(message);
        this.name = "FrlError";
        this.status = status;
    }
}

export type FrlFetch = (
    input: string,
    init?: RequestInit,
) => Promise<Response>;

export type FrlTitle = {
    id: string;
    name: string;
    collection: string | null;
    status: string;
    isPrincipal: boolean;
    isInForce: boolean;
    year: number | null;
    number: number | null;
    url: string;
};

export type FrlVersion = {
    titleId: string;
    name: string;
    status: string;
    start: string;
    end: string | null;
    registerId: string | null;
    compilationNumber: string | null;
    isLatest: boolean;
    hasUnincorporatedAmendments: boolean;
    reasons: { affect: string; markdown: string | null }[];
    url: string;
};

export type FrlSearchResult = {
    count: number;
    titles: FrlTitle[];
};

export type FrlLegislationText = {
    title: FrlTitle | null;
    version: FrlVersion;
    asAt: string | null;
    url: string;
    section: string | null;
    provision: FrlProvision | null;
    provisions: FrlProvision[];
    page: number;
    pageCount: number;
    text: string;
    attribution: string;
};

type ODataList<T> = {
    "@odata.count"?: number;
    value?: T[];
};

type JsonRecord = Record<string, unknown>;

const PROVISIONS_PER_PAGE = 20;

function defaultFetch(input: string, init?: RequestInit): Promise<Response> {
    return fetch(input, init);
}

function asString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean {
    return value === true;
}

function named(members: string[], value: unknown): string {
    if (typeof value === "number") return members[value] ?? String(value);
    return typeof value === "string" ? value : "";
}

function record(value: unknown): JsonRecord | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as JsonRecord)
        : null;
}

export function pathId(titleId: string): string {
    const trimmed = titleId.trim();
    if (!TITLE_ID_RE.test(trimmed)) {
        throw new FrlError(
            `"${titleId}" is not a register title id (letters and digits only, e.g. C2004A03348)`,
        );
    }
    return trimmed;
}

export function assertDate(date: string): string {
    const match = DATE_RE.exec(date);
    if (!match) {
        throw new FrlError(`date must be yyyy-mm-dd, got "${date}"`);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day
    ) {
        throw new FrlError(`"${date}" is not a real calendar date`);
    }
    if (year < 1901) {
        throw new FrlError(
            `"${date}" predates federation; the register starts in 1901`,
        );
    }
    return date;
}

export function registerUrl(titleId: string, asAt?: string | null): string {
    const id = pathId(titleId);
    return asAt
        ? `${FRL_WEB_BASE}/${id}/${assertDate(asAt)}/text`
        : `${FRL_WEB_BASE}/${id}`;
}

export function compilationCoversDate(
    version: { start: string; end: string | null },
    date: string,
): boolean {
    const asAt = assertDate(date);
    if (version.start > asAt) return false;
    return !version.end || version.end >= asAt;
}

function quoted(value: string): string {
    const out = value.replace(/'/g, "''").replace(/"/g, "");
    if (!out.trim()) {
        throw new FrlError(
            "the search query is empty once quoting characters are removed",
        );
    }
    return out;
}

function parseFrlError(status: number, detail: string, path: string): FrlError {
    const trimmed = detail.trim();
    let message = trimmed;
    try {
        const parsed = JSON.parse(trimmed) as unknown;
        const body = record(parsed);
        const nested = record(body?.error);
        const fromApi =
            asString(nested?.message) ??
            asString(body?.message) ??
            asString(body?.detail);
        if (fromApi) message = fromApi;
    } catch {
        // Non-JSON bodies stay as-is.
    }
    if (status === 429 || status === 403 || status === 401 || status === 503) {
        const err = new FrlError(
            officialSourceUnavailableMessage({
                name: "this Federal Register title",
                site: "legislation.gov.au",
            }),
            status,
        );
        err.kind = "unavailable";
        err.officialUrl = FRL_WEB_BASE;
        return err;
    }
    return new FrlError(
        message
            ? `FRL API responded ${status} for ${path}: ${message}`
            : `FRL API responded ${status} for ${path}`,
        status,
    );
}

async function frlRequest(
    path: string,
    init: RequestInit | undefined,
    fetchImpl: FrlFetch,
): Promise<Response> {
    const url = path.startsWith("http") ? path : `${FRL_BASE}${path}`;
    devLog("[frl/api] request", { method: init?.method ?? "GET", path, url });
    const response = await fetchImpl(url, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(30_000),
        headers: {
            "user-agent": FRL_USER_AGENT,
            accept: "application/json",
            ...(init?.headers ?? {}),
        },
    });
    devLog("[frl/api] response", {
        method: init?.method ?? "GET",
        path,
        status: response.status,
    });
    return response;
}

async function getJson<T>(
    path: string,
    fetchImpl: FrlFetch,
): Promise<T> {
    const response = await frlRequest(path, undefined, fetchImpl);
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw parseFrlError(response.status, detail, path);
    }
    return (await response.json()) as T;
}

function compactTitle(raw: unknown): FrlTitle | null {
    const row = record(raw);
    const id = asString(row?.id) ?? asString(row?.Id);
    const name = asString(row?.name) ?? asString(row?.Name);
    if (!id || !name) return null;
    return {
        id,
        name,
        collection: asString(row?.collection) ?? asString(row?.Collection),
        status: named(STATUS_NAMES, row?.status ?? row?.Status),
        isPrincipal: asBoolean(row?.isPrincipal ?? row?.IsPrincipal),
        isInForce: asBoolean(row?.isInForce ?? row?.IsInForce),
        year: asNumber(row?.year ?? row?.Year),
        number: asNumber(row?.number ?? row?.Number),
        url: registerUrl(id),
    };
}

function compactVersion(raw: unknown): FrlVersion | null {
    const row = record(raw);
    const titleId = asString(row?.titleId) ?? asString(row?.TitleId);
    const start = asString(row?.start) ?? asString(row?.Start);
    if (!titleId || !start) return null;
    const reasonsRaw = Array.isArray(row?.reasons) ? row.reasons : [];
    return {
        titleId,
        name: asString(row?.name) ?? asString(row?.Name) ?? titleId,
        status: named(STATUS_NAMES, row?.status ?? row?.Status),
        start,
        end: asString(row?.end) ?? asString(row?.End),
        registerId: asString(row?.registerId) ?? asString(row?.RegisterId),
        compilationNumber:
            asString(row?.compilationNumber) ??
            asString(row?.CompilationNumber),
        isLatest: asBoolean(row?.isLatest ?? row?.IsLatest ?? row?.isCurrent),
        hasUnincorporatedAmendments: asBoolean(
            row?.hasUnincorporatedAmendments ??
                row?.HasUnincorporatedAmendments,
        ),
        reasons: reasonsRaw
            .map((reason) => {
                const item = record(reason);
                if (!item) return null;
                return {
                    affect: named(AFFECT_NAMES, item.affect ?? item.Affect),
                    markdown:
                        asString(item.markdown) ?? asString(item.Markdown),
                };
            })
            .filter(
                (reason): reason is { affect: string; markdown: string | null } =>
                    !!reason,
            ),
        url: registerUrl(titleId, start.slice(0, 10)),
    };
}

function odataValues<T>(data: ODataList<T> | T[] | null | undefined): T[] {
    if (Array.isArray(data)) return data;
    return Array.isArray(data?.value) ? data.value : [];
}

export async function searchTitles(
    query: string,
    options: { limit?: number; fetchImpl?: FrlFetch } = {},
): Promise<FrlSearchResult> {
    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
    const fetchImpl = options.fetchImpl ?? defaultFetch;
    const criteria = encodeURIComponent(
        `text("${quoted(query)}",nameAndText,all)`,
    );
    const path = `/titles/search(criteria='${criteria}')?$top=${limit}&$count=true`;
    const data = await getJson<ODataList<unknown>>(path, fetchImpl);
    const titles = odataValues(data)
        .map(compactTitle)
        .filter((title): title is FrlTitle => !!title);
    return {
        count: asNumber(data["@odata.count"]) ?? titles.length,
        titles,
    };
}

export async function getTitle(
    titleId: string,
    options: { fetchImpl?: FrlFetch } = {},
): Promise<FrlTitle | null> {
    const fetchImpl = options.fetchImpl ?? defaultFetch;
    try {
        const data = await getJson<unknown>(
            `/Titles('${pathId(titleId)}')`,
            fetchImpl,
        );
        return compactTitle(data);
    } catch (error) {
        if (
            error instanceof FrlError &&
            (error.status === 404 || error.status === 400)
        ) {
            return null;
        }
        throw error;
    }
}

export async function findVersion(
    titleId: string,
    options: { asAt?: string; fetchImpl?: FrlFetch } = {},
): Promise<FrlVersion | null> {
    const fetchImpl = options.fetchImpl ?? defaultFetch;
    const selector = options.asAt
        ? `asAt=${assertDate(options.asAt)}T00:00:00`
        : `asAtSpecification='Latest'`;
    try {
        const data = await getJson<unknown>(
            `/Versions/Find(titleId='${pathId(titleId)}',${selector})`,
            fetchImpl,
        );
        return compactVersion(data);
    } catch (error) {
        if (error instanceof FrlError && error.status === 404) return null;
        throw error;
    }
}

export async function listVersions(
    titleId: string,
    options: { limit?: number; fetchImpl?: FrlFetch } = {},
): Promise<FrlVersion[]> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const fetchImpl = options.fetchImpl ?? defaultFetch;
    const filter = encodeURIComponent(`titleId eq '${pathId(titleId)}'`);
    const orderBy = encodeURIComponent("start desc");
    const data = await getJson<ODataList<unknown>>(
        `/Versions?$filter=${filter}&$orderby=${orderBy}&$top=${limit}`,
        fetchImpl,
    );
    return odataValues(data)
        .map(compactVersion)
        .filter((version): version is FrlVersion => !!version);
}

export function selectVersionAsAt(
    versions: FrlVersion[],
    date: string,
): FrlVersion | null {
    const asAt = assertDate(date);
    return (
        versions.find((version) => compilationCoversDate(version, asAt)) ??
        null
    );
}

async function downloadEpub(
    titleId: string,
    asAt: string | undefined,
    fetchImpl: FrlFetch,
): Promise<Uint8Array> {
    const selector = asAt
        ? `asat=${assertDate(asAt)}`
        : `asatspecification='Latest'`;
    const path =
        `/documents/find(titleid='${pathId(titleId)}',${selector},type='Primary',` +
        `format='Epub',uniqueTypeNumber=0,volumeNumber=0,rectificationVersionNumber=0)`;
    const response = await frlRequest(
        path,
        { headers: { accept: "application/epub+zip" } },
        fetchImpl,
    );
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw parseFrlError(response.status, detail, path);
    }
    return new Uint8Array(await response.arrayBuffer());
}

function pageProvisions(act: ActText, page: number): {
    page: number;
    pageCount: number;
    provisions: FrlProvision[];
} {
    const pageCount = Math.max(
        1,
        Math.ceil(act.provisions.length / PROVISIONS_PER_PAGE),
    );
    const safePage = Math.min(Math.max(page, 1), pageCount);
    const start = (safePage - 1) * PROVISIONS_PER_PAGE;
    return {
        page: safePage,
        pageCount,
        provisions: act.provisions.slice(start, start + PROVISIONS_PER_PAGE),
    };
}

function formatProvision(provision: FrlProvision): string {
    const heading = provision.heading
        ? `${provision.no} ${provision.heading}`
        : provision.no;
    const context = provision.context ? `${provision.context}\n` : "";
    return `${context}${heading}\n${provision.body}`.trim();
}

function formatContents(provisions: FrlProvision[]): string {
    return provisions
        .map((provision) =>
            provision.heading
                ? `${provision.no} ${provision.heading}`
                : provision.no,
        )
        .join("\n");
}

export async function getLegislationText(
    titleId: string,
    options: {
        asAt?: string;
        section?: string;
        page?: number;
        fetchImpl?: FrlFetch;
        epub?: Uint8Array;
        parseActFromEpub?: (epub: Uint8Array) => Promise<ActText> | ActText;
    } = {},
): Promise<FrlLegislationText> {
    const fetchImpl = options.fetchImpl ?? defaultFetch;
    const version = await findVersion(titleId, {
        asAt: options.asAt,
        fetchImpl,
    });
    if (!version) {
        throw new FrlError(
            options.asAt
                ? `No compilation of ${titleId} was in force on ${options.asAt}.`
                : `No current compilation of ${titleId} is available.`,
            404,
        );
    }
    const title = await getTitle(titleId, { fetchImpl });
    const epub =
        options.epub ??
        (await downloadEpub(titleId, options.asAt, fetchImpl));
    const act = await (options.parseActFromEpub ?? parseActFromEpub)(epub);
    const asAt = options.asAt ?? null;
    const url = registerUrl(titleId, asAt ?? version.start.slice(0, 10));
    const attribution =
        "Legislative material © Commonwealth of Australia, sourced from the Federal Register of Legislation, licensed CC BY 4.0.";

    if (options.section) {
        const provision = findProvision(act, options.section);
        return {
            title,
            version,
            asAt,
            url,
            section: options.section,
            provision,
            provisions: provision ? [provision] : [],
            page: 1,
            pageCount: 1,
            text: provision
                ? formatProvision(provision)
                : `Section ${options.section} was not found in this compilation.`,
            attribution,
        };
    }

    const paged = pageProvisions(act, options.page ?? 1);
    const text =
        paged.page === 1
            ? [
                  "Table of provisions:",
                  formatContents(act.provisions.slice(0, 80)),
                  act.provisions.length > 80
                      ? `… ${act.provisions.length - 80} further provisions`
                      : "",
                  "",
                  ...paged.provisions.map(formatProvision),
              ]
                  .filter(Boolean)
                  .join("\n")
            : paged.provisions.map(formatProvision).join("\n\n");

    return {
        title,
        version,
        asAt,
        url,
        section: null,
        provision: null,
        provisions: paged.provisions,
        page: paged.page,
        pageCount: paged.pageCount,
        text,
        attribution,
    };
}
