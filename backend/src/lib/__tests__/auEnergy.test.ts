import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    AuEnergyError,
    findAemcTocNode,
    findEnergyClause,
    flattenAemcToc,
    getEnergyText,
    isEnergyClauseNumber,
    listEnergyVersions,
    parseAemcVersions,
    parseEscVersions,
    parseRegulatorFiles,
    resolveEnergyInstrument,
    searchEnergyInstruments,
    selectEnergyVersionAsAt,
} from "../auEnergy";

const fixture = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures/esc-ercop.html"),
    "utf8",
);

const ERCOP = resolveEnergyInstrument("esc:ercop")!;

const AEMC_VERSIONS = {
    data: [
        {
            id: 802,
            version: 51,
            type: "nerr",
            start_date: "2026-07-01",
            end_date: null,
            is_current: 1,
        },
        {
            id: 790,
            version: 50,
            type: "nerr",
            start_date: "2026-02-01",
            end_date: "2026-06-30",
            is_current: 0,
        },
    ],
};

const AEMC_TOC = {
    data: [
        {
            id: 1,
            title: "Preliminary",
            index: "Part 1",
            children: [
                {
                    id: 10,
                    title: "Application",
                    index: "3",
                    children: [],
                },
            ],
        },
    ],
};

describe("Australian energy instrument catalog", () => {
    it("resolves the Victorian Energy Retail Code of Practice by common names", () => {
        expect(resolveEnergyInstrument("ERCOP")?.id).toBe("esc:ercop");
        expect(searchEnergyInstruments("energy retail code")[0]?.id).toBe(
            "esc:ercop",
        );
    });

    it("keeps national energy rules in the same catalog", () => {
        expect(resolveEnergyInstrument("nerr")?.id).toBe("aemc:nerr");
        expect(resolveEnergyInstrument("energy retail rules")?.id).toBe(
            "aemc:nerr",
        );
        expect(searchEnergyInstruments("national electricity rules")[0]?.id).toBe(
            "aemc:ner",
        );
    });

    it("resolves AER guidelines and AEMO procedures", () => {
        expect(resolveEnergyInstrument("ring-fencing")?.id).toBe(
            "aer:ring-fencing-ed",
        );
        expect(searchEnergyInstruments("b2b procedures")[0]?.id).toBe("aemo:b2b");
        expect(resolveEnergyInstrument("aer:retail-compliance")?.source).toBe(
            "aer",
        );
        expect(resolveEnergyInstrument("hardship")?.id).toBe("aer:hardship");
        expect(resolveEnergyInstrument("msats")?.id).toBe("aemo:msats");
        expect(resolveEnergyInstrument("victorian default offer")?.id).toBe(
            "esc:vdo",
        );
    });

    it("resolves NERL and adoption Acts", () => {
        expect(resolveEnergyInstrument("nerl")?.id).toBe("sa:nerl");
        expect(resolveEnergyInstrument("national electricity law")?.id).toBe(
            "sa:nel",
        );
        expect(resolveEnergyInstrument("nsw nerl")?.id).toBe("nsw:nerl-adoption");
        expect(resolveEnergyInstrument("qld nerl")?.id).toBe("qld:nerl-adoption");
    });
});

describe("AEMO landing-page files", () => {
    it("reads official PDF links from an AEMO procedure page", () => {
        const instrument = resolveEnergyInstrument("aemo:b2b")!;
        const versions = parseRegulatorFiles(
            `<a href="/-/media/files/electricity/nem/retail_and_metering/b2b/2026/b2b-procedure-service-order-process-v401.pdf">Service Order v4.01</a>`,
            instrument,
        );
        expect(versions[0]?.downloadUrl).toContain(
            "b2b-procedure-service-order-process-v401.pdf",
        );
        expect(versions[0]?.start).toBe("2026-01-01");
    });
});

describe("ESC landing-page versions", () => {
    it("reads Word versions and ignores unrelated ESC files", () => {
        const versions = parseEscVersions(fixture, ERCOP);
        expect(versions.map((version) => version.label)).toEqual([
            "version 6",
            "version 5",
        ]);
        expect(versions[0].isLatest).toBe(true);
        expect(versions[0].start).toBe("2026-07-01");
        expect(versions[1].end).toBe("2026-06-30");
        expect(versions[0].downloadUrl).toContain("version%206");
    });

    it("selects the compilation whose window covers an as-at date", () => {
        const versions = parseEscVersions(fixture, ERCOP);
        expect(selectEnergyVersionAsAt(versions, "2026-03-01")?.label).toBe(
            "version 5",
        );
        expect(selectEnergyVersionAsAt(versions, "2026-07-01")?.label).toBe(
            "version 6",
        );
    });
});

describe("AEMC rule versions", () => {
    it("maps version ids and in-force windows", () => {
        const versions = parseAemcVersions(
            AEMC_VERSIONS,
            resolveEnergyInstrument("aemc:nerr")!,
        );
        expect(versions[0]).toMatchObject({
            label: "version 51",
            aemcVersionId: 802,
            isLatest: true,
        });
        expect(selectEnergyVersionAsAt(versions, "2026-03-15")?.aemcVersionId).toBe(
            790,
        );
    });

    it("finds a retail rule by clause number", () => {
        const nodes = flattenAemcToc(AEMC_TOC);
        expect(findAemcTocNode(nodes, "3")?.id).toBe(10);
        expect(findAemcTocNode(nodes, "Part 1")?.id).toBe(1);
    });
});

describe("energy clause extraction", () => {
    it("returns a named clause and paginates the whole instrument", () => {
        const text = [
            "70 Undercharge",
            "A retailer may recover.",
            "71 Overcharge",
            "71(8) The commission must publish the threshold.",
            "72 Payment methods",
        ].join("\n");
        expect(findEnergyClause(text, "71").text).toContain("71(8)");
        expect(findEnergyClause(text, "71").text).not.toContain("Payment methods");
        expect(findEnergyClause(text).pageCount).toBe(1);
    });

    it("skips a version-history table numbered like clauses", () => {
        const text = [
            "Version history",
            "3 1 October 2024 Minor amendments to numbering.",
            "4 30 September 2025 Minor administrative amendment",
            "5 1 February 2026 improving awareness of dispute resolution.",
            "6 1 July 2026 Amendments to implement consumer reforms.",
            "3 Application",
            "This Code applies to the sale of energy.",
            "5 Definitions",
            "small customer means a customer who is a small customer under the Act.",
            "6 Billing",
        ].join("\n");
        expect(findEnergyClause(text, "3").text).toContain("This Code applies");
        expect(findEnergyClause(text, "3").text).not.toContain("Version history");
        expect(findEnergyClause(text, "5").text).toContain("small customer means");
        expect(findEnergyClause(text, "5").text).not.toContain("1 February 2026");
    });

    it("treats a heading or defined term as a lookup, not only a clause number", () => {
        const text = [
            "3 Application",
            "This Code applies to the sale of energy.",
            "5 Definitions",
            "small customer means a customer who is a small customer under the Act.",
            "retailer means a person who is licensed to sell energy.",
            "6 Billing",
            "A retailer must issue a bill.",
        ].join("\n");
        expect(isEnergyClauseNumber("120B")).toBe(true);
        expect(isEnergyClauseNumber("Definitions")).toBe(false);
        expect(findEnergyClause(text, "Definitions").text).toContain(
            "small customer means",
        );
        expect(findEnergyClause(text, "Definitions").text).not.toContain(
            "A retailer must issue a bill",
        );
        expect(findEnergyClause(text, "small customer").text).toContain(
            "under the Act",
        );
        expect(findEnergyClause(text, "small customer").text).not.toContain(
            "A retailer must issue a bill",
        );
        expect(() => findEnergyClause(text, "large customer")).toThrow(
            /not found/,
        );
    });
});

describe("energy instrument search", () => {
    it("matches when the query adds a topic after the instrument name", () => {
        expect(
            searchEnergyInstruments(
                "Energy Retail Code of Practice small customer definition",
            )[0]?.id,
        ).toBe("esc:ercop");
        expect(
            searchEnergyInstruments("National Energy Retail Law small customer")[0]
                ?.id,
        ).toBe("sa:nerl");
    });
});

describe("getEnergyText against recorded responses", () => {
    it("reads a defined term from the full ESC compilation", async () => {
        const fetched = await getEnergyText("esc:ercop", {
            clause: "small customer",
            fetchImpl: async (url) => {
                if (String(url).includes("energy-retail-code-practice") && !String(url).includes(".docx")) {
                    return new Response(fixture, { status: 200 });
                }
                if (String(url).endsWith(".docx")) {
                    return new Response(Buffer.from("docx"), { status: 200 });
                }
                throw new Error(`unexpected ${url}`);
            },
            extractDocx: async () =>
                [
                    "3 Application",
                    "This Code applies to the sale of energy.",
                    "5 Definitions",
                    "small customer means a customer who is a small customer under the Act.",
                    "6 Billing",
                ].join("\n"),
        });
        expect(fetched.instrumentId).toBe("esc:ercop");
        expect(fetched.clause).toBe("small customer");
        expect(fetched.text).toContain("small customer under the Act");
        expect(fetched.text).not.toContain("6 Billing");
    });

    it("fetches the current ESC Word compilation", async () => {
        const fetched = await getEnergyText("esc:ercop", {
            clause: "71",
            fetchImpl: async (url) => {
                if (String(url).includes("energy-retail-code-practice") && !String(url).includes(".docx")) {
                    return new Response(fixture, { status: 200 });
                }
                if (String(url).endsWith(".docx")) {
                    return new Response(Buffer.from("docx"), { status: 200 });
                }
                throw new Error(`unexpected ${url}`);
            },
            extractDocx: async () =>
                "70 Undercharge\n71 Overcharge\n71(8) The commission must publish.\n72 Payment",
        });
        expect(fetched.instrumentId).toBe("esc:ercop");
        expect(fetched.clause).toBe("71");
        expect(fetched.text).toContain("commission must publish");
        expect(fetched.url).toContain(".docx");
    });

    it("reads an AEMC clause from the rules API", async () => {
        const fetched = await getEnergyText("nerr", {
            clause: "3",
            fetchImpl: async (url) => {
                const href = String(url);
                if (href.includes("/versions")) {
                    return Response.json(AEMC_VERSIONS);
                }
                if (href.endsWith("/toc")) {
                    return Response.json(AEMC_TOC);
                }
                if (href.includes("/content/10")) {
                    return Response.json({
                        data: {
                            id: 10,
                            index: "3",
                            title: "Application",
                            content: "<p>These Rules apply to the sale of energy.</p>",
                        },
                    });
                }
                throw new Error(`unexpected ${url}`);
            },
        });
        expect(fetched.instrumentId).toBe("aemc:nerr");
        expect(fetched.text).toContain("sale of energy");
        expect(fetched.url).toContain("/nerr/802/10");
    });

    it("reads an AER guideline PDF from the catalog file URL", async () => {
        const fetched = await getEnergyText("aer:ring-fencing-ed", {
            clause: "3",
            fetchImpl: async (url) => {
                const href = String(url);
                if (href.includes("aer.gov.au") && href.endsWith(".pdf")) {
                    return new Response(Buffer.from("%PDF"), { status: 200 });
                }
                if (href.includes("aer.gov.au")) {
                    return new Response("<html>no files</html>", { status: 200 });
                }
                throw new Error(`unexpected ${url}`);
            },
            extractPdf: async () =>
                "2 Purpose\n3 Application\nThese guidelines apply to distributors.\n4 Obligations",
        });
        expect(fetched.instrumentId).toBe("aer:ring-fencing-ed");
        expect(fetched.text).toContain("guidelines apply to distributors");
    });

    it("falls back to a curated ESC PDF when the landing page has no Word file", async () => {
        const fetched = await getEnergyText("esc:vdo", {
            fetchImpl: async (url) => {
                if (String(url).includes("victorian-default-offer") && !String(url).includes(".pdf")) {
                    return new Response("<html>no word files</html>", { status: 200 });
                }
                if (String(url).endsWith(".pdf")) {
                    return new Response(Buffer.from("%PDF"), { status: 200 });
                }
                throw new Error(`unexpected ${url}`);
            },
            extractPdf: async () =>
                "1 Purpose\nThis price determination is made.\n2 Tariffs",
        });
        expect(fetched.instrumentId).toBe("esc:vdo");
        expect(fetched.text).toContain("price determination");
        expect(fetched.url).toContain(".pdf");
    });

    it("rejects an unknown instrument", async () => {
        await expect(getEnergyText("made-up")).rejects.toBeInstanceOf(
            AuEnergyError,
        );
    });

    it("marks a blocked official download as unavailable", async () => {
        await expect(
            getEnergyText("sa:nerl", {
                clause: "5",
                fetchImpl: async () =>
                    new Response("<html><title>Just a moment...</title></html>", {
                        status: 403,
                    }),
            }),
        ).rejects.toMatchObject({
            name: "AuEnergyError",
            kind: "unavailable",
            status: 403,
        });
    });

    it("pulls official text through Exa after a blocked download", async () => {
        const fetched = await getEnergyText("sa:nerl", {
            clause: "5",
            fetchImpl: async () =>
                new Response("<html><title>Just a moment...</title></html>", {
                    status: 403,
                }),
            exaFetch: async () => ({
                text: [
                    "4 Interpretation",
                    "5 Application",
                    "This Law applies to the sale and supply of energy.",
                    "6 Crown",
                ].join("\n"),
                url: "https://www.legislation.sa.gov.au/nerl.pdf",
                title: "NERL",
            }),
        });
        expect(fetched.clause).toBe("5");
        expect(fetched.text).toContain("sale and supply of energy");
        expect(fetched.retrievedVia).toBe("exa");
        expect(fetched.url).toContain("legislation.sa.gov.au");
    });

    it("lists ESC versions from the official page", async () => {
        const versions = await listEnergyVersions("Energy Retail Code of Practice", {
            fetchImpl: async () => new Response(fixture, { status: 200 }),
        });
        expect(versions).toHaveLength(2);
        expect(versions[0].label).toBe("version 6");
    });
});
