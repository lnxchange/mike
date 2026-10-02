import { describe, expect, it } from "vitest";
import {
    AuVicError,
    authorisedFileUrl,
    findVicSection,
    getVicLegislationText,
    parseActNumber,
    parseVicListing,
    parseVicPage,
    parseVicTitleId,
    searchKnownVicTitles,
    searchListedVicTitles,
    searchVicLegislation,
    selectVicVersionAsAt,
    slugifyVicTitle,
} from "../auVicLegislation";

const TIDE_PAGE = {
    title: "Electricity Industry Act 2000",
    header: {
        title: "Electricity Industry Act 2000",
        meta: ["Act number 68 / 2000", "Version 107"],
    },
    meta: {
        url: "/in-force/acts/electricity-industry-act-2000",
    },
    versions: [
        {
            version: "107",
            date: "2026-07-01T00:00:00",
            url: "/in-force/acts/electricity-industry-act-2000",
            status: "In force",
        },
        {
            version: "106",
            date: "2025-01-01T00:00:00",
            url: "/in-force/acts/electricity-industry-act-2000/106",
            status: "Superseded",
        },
    ],
};

describe("Victorian legislation catalog", () => {
    it("resolves energy-relevant Victorian Acts by common names", () => {
        expect(searchKnownVicTitles("electricity industry")[0]?.id).toBe(
            "vic:electricity-industry-act-2000",
        );
        expect(searchKnownVicTitles("NEVA")[0]?.slug).toBe(
            "national-electricity-victoria-act-2005",
        );
        expect(parseVicTitleId("vic:sr:some-rule")?.collection).toBe(
            "statutory-rules",
        );
        expect(slugifyVicTitle("Electricity Industry Act 2000")).toBe(
            "electricity-industry-act-2000",
        );
        expect(searchKnownVicTitles("vcat act")[0]?.id).toBe(
            "vic:victorian-civil-and-administrative-tribunal-act-1998",
        );
        expect(searchKnownVicTitles("electric line clearance")[0]?.id).toBe(
            "vic:sr:electricity-safety-electric-line-clearance-regulations-2020",
        );
    });

    it("reads in-force listing links from Tide HTML or JSON", () => {
        const titles = parseVicListing({
            body: `<a href="/in-force/acts/water-act-1989">Water Act 1989</a>
<a href="/in-force/statutory-rules/gas-safety-safety-case-regulations-2018">Gas Safety (Safety Case) Regulations 2018</a>`,
        });
        expect(titles.map((title) => title.id)).toEqual([
            "vic:water-act-1989",
            "vic:sr:gas-safety-safety-case-regulations-2018",
        ]);
        expect(
            searchListedVicTitles(titles, "safety case")[0]?.collection,
        ).toBe("statutory-rules");
    });
});

describe("Victorian Tide pages", () => {
    it("reads the title, Act number, and authorised PDF URL", () => {
        const parsed = parseVicPage(TIDE_PAGE);
        expect(parsed?.title).toMatchObject({
            id: "vic:electricity-industry-act-2000",
            number: "68",
            year: 2000,
        });
        expect(parsed?.versions[0]).toMatchObject({
            label: "version 107",
            isLatest: true,
            start: "2026-07-01",
        });
        expect(parsed?.versions[0].fileUrl).toBe(
            authorisedFileUrl({
                year: 2000,
                number: "68",
                version: "107",
                start: "2026-07-01",
            }),
        );
        expect(parsed?.versions[0].fileUrl).toContain(
            "2026-07/00-68aa107-authorised.pdf",
        );
        expect(selectVicVersionAsAt(parsed!.versions, "2025-06-01")?.label).toBe(
            "version 106",
        );
    });

    it("parses Act numbers from Tide header meta", () => {
        expect(parseActNumber(["Act number 68 / 2000"])).toEqual({
            number: "68",
            year: 2000,
        });
    });
});

describe("Victorian section extraction", () => {
    it("returns a named section and paginates the whole title", () => {
        const text = [
            "40 Licence condition",
            "A licensee must comply.",
            "40A Further condition",
            "The commission may impose.",
            "41 Transfer",
        ].join("\n");
        expect(findVicSection(text, "40").text).toContain("licensee must comply");
        expect(findVicSection(text, "40").text).not.toContain("Further condition");
        expect(findVicSection(text).pageCount).toBe(1);
    });
});

describe("getVicLegislationText against recorded responses", () => {
    it("downloads the authorised PDF for the current version", async () => {
        const fetched = await getVicLegislationText(
            "Electricity Industry Act 2000",
            {
                section: "40",
                fetchImpl: async (url) => {
                    if (String(url).includes("/api/tide/page")) {
                        return Response.json(TIDE_PAGE);
                    }
                    if (String(url).includes("authorised.pdf")) {
                        return new Response(Buffer.from("%PDF"), { status: 200 });
                    }
                    throw new Error(`unexpected ${url}`);
                },
                extractPdf: async () =>
                    "39 Earlier\n40 Licence condition\nA licensee must comply.\n41 Transfer",
            },
        );
        expect(fetched.titleId).toBe("vic:electricity-industry-act-2000");
        expect(fetched.section).toBe("40");
        expect(fetched.text).toContain("licensee must comply");
        expect(fetched.url).toContain("authorised.pdf");
    });

    it("falls back to the curated catalog when Tide has no page", async () => {
        const titles = await searchVicLegislation("climate change", {
            fetchImpl: async () => new Response("missing", { status: 404 }),
        });
        expect(titles[0]?.id).toBe("vic:climate-change-act-2017");
    });

    it("rejects an unknown title", async () => {
        await expect(
            getVicLegislationText("made-up", {
                fetchImpl: async () => new Response("missing", { status: 404 }),
            }),
        ).rejects.toBeInstanceOf(AuVicError);
    });
});
