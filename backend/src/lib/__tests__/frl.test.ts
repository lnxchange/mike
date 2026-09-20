import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
    assertDate,
    compilationCoversDate,
    findVersion,
    FrlError,
    getLegislationText,
    listVersions,
    pathId,
    registerUrl,
    searchTitles,
    selectVersionAsAt,
} from "../frl";
import { findProvision, parseActHtml } from "../frlText";

const SEARCH_BODY = {
    "@odata.count": 2,
    value: [
        {
            id: "C2004A00101",
            name: "Competition and Consumer Act 2010",
            collection: "Act",
            status: "InForce",
            isPrincipal: true,
            isInForce: true,
            year: 2010,
            number: 51,
        },
        {
            id: "C2004A00001",
            name: "Competition and Consumer Amendment Act 2010",
            collection: "Act",
            status: 1,
            isPrincipal: false,
            isInForce: false,
            year: 2010,
            number: 148,
        },
    ],
};

const LATEST_VERSION = {
    titleId: "C2004A00101",
    name: "Competition and Consumer Act 2010",
    status: "InForce",
    start: "2026-01-01T00:00:00",
    end: null,
    registerId: "C2026C00001",
    compilationNumber: "150",
    isLatest: true,
    hasUnincorporatedAmendments: false,
    reasons: [{ affect: "Amend", markdown: "Amended by F2025L00001" }],
};

const OLD_VERSION = {
    titleId: "C2004A00101",
    name: "Competition and Consumer Act 2010",
    status: "InForce",
    start: "2010-01-01T00:00:00",
    end: "2025-12-31T00:00:00",
    registerId: "C2010C00001",
    compilationNumber: "1",
    isLatest: false,
    reasons: [],
};

const TITLE = {
    id: "C2004A00101",
    name: "Competition and Consumer Act 2010",
    collection: "Act",
    status: "InForce",
    isPrincipal: true,
    isInForce: true,
    year: 2010,
    number: 51,
};

const SECTION_HTML = `
<html>
  <body>
    <h1 class="ActHead1">Part I—Preliminary</h1>
    <p class="ActHead5"><span class="CharSectno">18</span> Misleading or deceptive conduct</p>
    <p>A person must not, in trade or commerce, engage in conduct that is misleading or deceptive or is likely to mislead or deceive.</p>
    <p class="ActHead5"><span class="CharSectno">21</span> Unconscionable conduct</p>
    <p>A person must not, in trade or commerce, in connection with the supply of goods or services, engage in conduct that is, in all the circumstances, unconscionable.</p>
  </body>
</html>
`;

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function fetchFor(routes: Record<string, Response | (() => Response)>): (
    input: string,
) => Promise<Response> {
    return async (input) => {
        const url = new URL(input);
        const key = `${url.pathname}${url.search}`;
        const match =
            routes[key] ??
            Object.entries(routes).find(([path]) =>
                key.includes(path),
            )?.[1];
        if (!match) {
            return new Response(`missing fixture for ${key}`, { status: 404 });
        }
        return typeof match === "function" ? match() : match;
    };
}

async function sampleEpub(): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file("OEBPS/document_1/document_1.html", SECTION_HTML);
    return zip.generateAsync({ type: "uint8array" });
}

describe("FRL helpers", () => {
    it("accepts register ids and rejects path-breaking values", () => {
        expect(pathId("C2004A03348")).toBe("C2004A03348");
        expect(() => pathId("C2004A03348/../x")).toThrow(FrlError);
    });

    it("validates calendar dates and rejects dates before federation", () => {
        expect(assertDate("2026-07-01")).toBe("2026-07-01");
        expect(() => assertDate("2026-13-01")).toThrow(/not a real calendar date/);
        expect(() => assertDate("1899-01-01")).toThrow(/predates federation/);
    });

    it("builds official register URLs", () => {
        expect(registerUrl("C2004A00101")).toBe(
            "https://www.legislation.gov.au/C2004A00101",
        );
        expect(registerUrl("C2004A00101", "2026-07-01")).toBe(
            "https://www.legislation.gov.au/C2004A00101/2026-07-01/text",
        );
    });

    it("selects the compilation whose in-force window covers a date", () => {
        const versions = [
            {
                start: "2026-01-01",
                end: null,
            },
            {
                start: "2010-01-01",
                end: "2025-12-31",
            },
        ];
        expect(compilationCoversDate(versions[0]!, "2026-07-01")).toBe(true);
        expect(compilationCoversDate(versions[1]!, "2015-06-01")).toBe(true);
        expect(compilationCoversDate(versions[1]!, "2026-07-01")).toBe(false);

        const selected = selectVersionAsAt(
            [
                { ...LATEST_VERSION, start: "2026-01-01", end: null },
                { ...OLD_VERSION, start: "2010-01-01", end: "2025-12-31" },
            ],
            "2015-06-01",
        );
        expect(selected?.compilationNumber).toBe("1");
    });
});

describe("FRL search and versions", () => {
    it("searches titles and normalises enum statuses", async () => {
        const result = await searchTitles("competition and consumer", {
            fetchImpl: fetchFor({
                "/v1/titles/search": jsonResponse(SEARCH_BODY),
            }),
        });
        expect(result.count).toBe(2);
        expect(result.titles[0]).toMatchObject({
            id: "C2004A00101",
            name: "Competition and Consumer Act 2010",
            status: "InForce",
            url: "https://www.legislation.gov.au/C2004A00101",
        });
        expect(result.titles[1]?.status).toBe("Ceased");
    });

    it("finds the current compilation and lists versions newest first", async () => {
        const current = await findVersion("C2004A00101", {
            fetchImpl: fetchFor({
                "/v1/Versions/Find": jsonResponse(LATEST_VERSION),
            }),
        });
        expect(current?.compilationNumber).toBe("150");
        expect(current?.url).toContain("/2026-01-01/text");

        const versions = await listVersions("C2004A00101", {
            fetchImpl: fetchFor({
                "/v1/Versions": jsonResponse({
                    value: [LATEST_VERSION, OLD_VERSION],
                }),
            }),
        });
        expect(versions).toHaveLength(2);
        expect(versions[0]?.isLatest).toBe(true);
        expect(versions[1]?.reasons).toEqual([]);
    });

    it("reads a named section from a fixture epub", async () => {
        const epub = await sampleEpub();
        const result = await getLegislationText("C2004A00101", {
            section: "18",
            epub,
            fetchImpl: fetchFor({
                "/v1/Versions/Find": jsonResponse(LATEST_VERSION),
                "/v1/Titles": jsonResponse(TITLE),
            }),
        });
        expect(result.provision?.no).toBe("18");
        expect(result.text).toContain("misleading or deceptive");
        expect(result.attribution).toContain("CC BY 4.0");
        expect(result.url).toContain("legislation.gov.au/C2004A00101");
    });

    it("selects the as-at compilation when asking for a past date", async () => {
        const epub = await sampleEpub();
        const result = await getLegislationText("C2004A00101", {
            asAt: "2015-06-01",
            section: "s 18",
            epub,
            fetchImpl: fetchFor({
                "/v1/Versions/Find": jsonResponse(OLD_VERSION),
                "/v1/Titles": jsonResponse(TITLE),
            }),
        });
        expect(result.version.compilationNumber).toBe("1");
        expect(result.asAt).toBe("2015-06-01");
        expect(result.provision?.no).toBe("18");
    });
});

describe("FRL text parser", () => {
    it("extracts numbered provisions and finds a section by informal citation", () => {
        const act = parseActHtml(SECTION_HTML);
        expect(act.provisions.map((provision) => provision.no)).toEqual([
            "18",
            "21",
        ]);
        expect(findProvision(act, "section 21")?.heading).toBe(
            "Unconscionable conduct",
        );
    });
});
