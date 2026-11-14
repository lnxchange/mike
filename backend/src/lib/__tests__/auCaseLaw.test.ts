import { describe, expect, it } from "vitest";
import {
    findCasePassage,
    getAuCase,
    officialCaseUrl,
    parseFcaSearch,
    parseMediumNeutralCitation,
    parseNswDecision,
    parseNswSearch,
    parseVscSearch,
    searchAuCases,
} from "../auCaseLaw";

const NSW_SEARCH_HTML = `
<a href="/cases/foo">Retailer v Distributor</a>
<a href="/decision/abc123def456">[2024] NSWSC 10</a>
`;

const NSW_DECISION_HTML = `
<title>Retailer v Distributor - NSW Caselaw</title>
<h1>Supreme Court</h1>
<p>Medium Neutral Citation: [2024] NSWSC 10</p>
<div class="decision-body">
<p>[41] Earlier.</p>
<p>[42] A retailer must disclose the standing offer.</p>
<p>[43] Later.</p>
</div>
<div class="footer">Copyright</div>
`;

const FCA_SEARCH_HTML = `
<a href="https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2024/2024fca0001">[2024] FCA 1</a>
`;

describe("Australian case citations", () => {
    it("parses medium-neutral citations and builds official URLs", () => {
        expect(parseMediumNeutralCitation("[2024] HCA 12")).toMatchObject({
            court: "HCA",
            number: "12",
        });
        expect(officialCaseUrl("[2024] HCA 12")?.url).toBe(
            "https://eresources.hcourt.gov.au/showCase/2024/HCA/12",
        );
        expect(officialCaseUrl("[2024] FCA 1")?.id).toBe("fca:[2024]FCA1");
    });

    it("points Victorian citations at the Supreme Court site, not AustLII", () => {
        expect(officialCaseUrl("[2024] VSC 365")).toMatchObject({
            source: "vsc",
            court: "VSC",
        });
        expect(officialCaseUrl("[2024] VSC 365")?.url).toContain(
            "supremecourt.vic.gov.au",
        );
        expect(officialCaseUrl("[2024] VSCA 12")?.court).toBe("VSCA");
    });
});

describe("official search HTML", () => {
    it("reads NSW Caselaw decision links", () => {
        const hits = parseNswSearch(NSW_SEARCH_HTML);
        expect(hits[0]).toMatchObject({
            id: "nsw:abc123def456",
            citation: "[2024] NSWSC 10",
            url: "https://www.caselaw.nsw.gov.au/decision/abc123def456",
        });
    });

    it("extracts NSW judgment text", () => {
        const fetched = parseNswDecision(NSW_DECISION_HTML, "nsw:abc123def456");
        expect(fetched.citation).toBe("[2024] NSWSC 10");
        expect(fetched.text).toContain("standing offer");
        expect(fetched.text).not.toContain("script");
    });

    it("reads Federal Court Funnelback results", () => {
        const hits = parseFcaSearch(FCA_SEARCH_HTML);
        expect(hits[0]?.citation).toBe("[2024] FCA 1");
        expect(hits[0]?.url).toContain("judgments.fedcourt.gov.au");
    });

    it("reads official VSC PDFs and skips judgment summaries", () => {
        const hits = parseVscSearch(
            `
<a href="/sites/default/files/2024-08/GCO%20Ruling%20%5B2024%5D%20VSC%20365.pdf">[2024] VSC 365</a>
<a href="/sites/default/files/2024-08/Summary%20%5B2024%5D%20VSC%20365.pdf">Summary [2024] VSC 365</a>
`,
            "[2024] VSC 365",
        );
        expect(hits).toHaveLength(1);
        expect(hits[0]?.url).toContain("GCO");
        expect(hits[0]?.url).not.toContain("Summary");
    });
});

describe("judgment passages", () => {
    it("returns a numbered paragraph", () => {
        const text = "[41] Earlier.\n[42] A retailer must disclose.\n[43] Later.";
        expect(findCasePassage(text, "42").text).toContain("retailer must disclose");
        expect(findCasePassage(text, "42").text).not.toContain("Later");
    });
});

describe("getAuCase against recorded responses", () => {
    it("reads an NSW Caselaw decision by id", async () => {
        const fetched = await getAuCase("nsw:abc123def456", {
            paragraph: "42",
            fetchImpl: async (url) => {
                if (String(url).includes("/decision/abc123def456")) {
                    return new Response(NSW_DECISION_HTML, { status: 200 });
                }
                throw new Error(`unexpected ${url}`);
            },
        });
        expect(fetched.id).toBe("nsw:abc123def456");
        expect(fetched.section).toBe("42");
        expect(fetched.text).toContain("standing offer");
    });

    it("resolves a High Court citation to eresources", async () => {
        const fetched = await getAuCase("[2024] HCA 12", {
            fetchImpl: async (url) => {
                expect(String(url)).toContain("/showCase/2024/HCA/12");
                return new Response(
                    "<html><p>[1] The appeal is dismissed.</p></html>",
                    { status: 200 },
                );
            },
        });
        expect(fetched.id).toBe("hca:2024:12");
        expect(fetched.text).toContain("appeal is dismissed");
        expect(fetched.attribution).toContain("High Court");
    });

    it("searches NSW and the Federal Court together", async () => {
        const hits = await searchAuCases("retailer standing offer", {
            fetchImpl: async (url) => {
                if (String(url).includes("caselaw.nsw.gov.au")) {
                    return new Response(NSW_SEARCH_HTML, { status: 200 });
                }
                if (String(url).includes("search.judgments.fedcourt.gov.au")) {
                    return new Response(FCA_SEARCH_HTML, { status: 200 });
                }
                throw new Error(`unexpected ${url}`);
            },
        });
        expect(hits.map((hit) => hit.source).sort()).toEqual(["fca", "nsw"]);
    });

    it("reads a recent VSC PDF from the Court site", async () => {
        const fetched = await getAuCase("[2024] VSC 365", {
            paragraph: "54",
            fetchImpl: async (url) => {
                const href = String(url);
                if (href.includes("supremecourt.vic.gov.au/search")) {
                    return new Response(
                        `<a href="/sites/default/files/2024-08/GCO%20Ruling%20%5B2024%5D%20VSC%20365.pdf">[2024] VSC 365</a>`,
                        { status: 200 },
                    );
                }
                if (href.endsWith(".pdf")) {
                    return new Response(Buffer.from("%PDF"), { status: 200 });
                }
                throw new Error(`unexpected ${url}`);
            },
            extractPdf: async () =>
                "[53] Earlier.\n[54] I will make a GCO.\n[55] Later.",
        });
        expect(fetched.court).toBe("VSC");
        expect(fetched.section).toBe("54");
        expect(fetched.text).toContain("make a GCO");
        expect(fetched.url).toContain("supremecourt.vic.gov.au");
        expect(fetched.attribution).toContain("Supreme Court of Victoria");
    });

    it("says so when no official VSC PDF is on the Court site", async () => {
        await expect(
            getAuCase("[2020] VSC 1", {
                fetchImpl: async () => new Response("<html>none</html>", { status: 200 }),
            }),
        ).rejects.toThrow(/AustLII is not used/);
    });
});
