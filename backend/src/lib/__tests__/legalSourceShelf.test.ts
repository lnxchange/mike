import { describe, expect, it } from "vitest";
import {
    ENERGY_SHELF_IDS,
    legalShelfRefreshIsDue,
    refreshHeldLegalSources,
    sameOfficialVersion,
    VIC_SHELF_IDS,
    type HeldShelfRow,
} from "../legalSourceShelf";

const HELD: HeldShelfRow = {
    id: "row-1",
    orgId: "org-1",
    userId: null,
    family: "energy",
    instrumentId: "esc:ercop",
    name: "Energy Retail Code of Practice",
    versionLabel: "version 6",
    officialUrl:
        "https://www.esc.vic.gov.au/sites/default/files/documents/ercop-v6.docx",
};

describe("energy shelf catalog", () => {
    it("covers the ordinary retail instruments plus the Victorian threshold Acts", () => {
        expect(ENERGY_SHELF_IDS).toContain("esc:ercop");
        expect(ENERGY_SHELF_IDS).toContain("sa:nerl");
        expect(ENERGY_SHELF_IDS).toContain("aemc:nerr");
        expect(ENERGY_SHELF_IDS).toContain("aer:hardship");
        expect(ENERGY_SHELF_IDS).toContain("aemo:msats");
        expect(VIC_SHELF_IDS).toEqual([
            "vic:electricity-industry-act-2000",
            "vic:gas-industry-act-2001",
        ]);
    });
});

describe("legalShelfRefreshIsDue", () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    const now = Date.parse("2026-09-21T00:00:00Z");

    it("enqueues when nothing has run, and skips a recent successful run", () => {
        expect(legalShelfRefreshIsDue(null, now, week)).toBe(true);
        expect(
            legalShelfRefreshIsDue(
                { status: "pending", finished_at: null },
                now,
                week,
            ),
        ).toBe(false);
        expect(
            legalShelfRefreshIsDue(
                {
                    status: "done",
                    finished_at: "2026-09-20T00:00:00Z",
                },
                now,
                week,
            ),
        ).toBe(false);
        expect(
            legalShelfRefreshIsDue(
                {
                    status: "done",
                    finished_at: "2026-09-10T00:00:00Z",
                },
                now,
                week,
            ),
        ).toBe(true);
        expect(
            legalShelfRefreshIsDue(
                { status: "failed", finished_at: "2026-09-20T00:00:00Z" },
                now,
                week,
            ),
        ).toBe(true);
    });
});

describe("sameOfficialVersion", () => {
    it("matches on version label or the same official file URL", () => {
        expect(
            sameOfficialVersion(HELD, {
                label: "version 6",
                url: "https://www.esc.vic.gov.au/electricity-and-gas/codes-guidelines-and-policies/energy-retail-code-practice",
                downloadUrl: HELD.officialUrl,
            }),
        ).toBe(true);
        expect(
            sameOfficialVersion(
                { ...HELD, versionLabel: "current" },
                {
                    label: "Energy Retail Code of Practice version 6",
                    url: "https://www.esc.vic.gov.au/page",
                    downloadUrl: `${HELD.officialUrl}?download=1`,
                },
            ),
        ).toBe(true);
        expect(
            sameOfficialVersion(HELD, {
                label: "version 7",
                url: "https://www.esc.vic.gov.au/page",
                downloadUrl:
                    "https://www.esc.vic.gov.au/sites/default/files/documents/ercop-v7.docx",
            }),
        ).toBe(false);
    });
});

describe("refreshHeldLegalSources", () => {
    it("touches last_checked only when the official version is unchanged", async () => {
        const current: string[] = [];
        const results = await refreshHeldLegalSources([HELD], {
            listEnergyVersions: async () => [
                {
                    instrumentId: "esc:ercop",
                    label: "version 6",
                    start: "2026-07-01",
                    end: null,
                    isLatest: true,
                    url: "https://www.esc.vic.gov.au/page",
                    downloadUrl: HELD.officialUrl,
                },
            ],
            getEnergyText: async () => {
                throw new Error("should not re-download");
            },
            markCurrent: async (id) => {
                current.push(id);
            },
            markUnconfirmed: async () => {
                throw new Error("should stay current");
            },
            replace: async () => {
                throw new Error("should not replace");
            },
        });
        expect(results).toEqual([
            {
                instrumentId: "esc:ercop",
                family: "energy",
                action: "current",
                versionLabel: "version 6",
            },
        ]);
        expect(current).toEqual(["row-1"]);
    });

    it("fetches once and replaces the held copy when the version changes", async () => {
        const replaced: Array<{ id: string; versionLabel: string; chars: number }> =
            [];
        const results = await refreshHeldLegalSources([HELD], {
            listEnergyVersions: async () => [
                {
                    instrumentId: "esc:ercop",
                    label: "version 7",
                    start: "2026-10-01",
                    end: null,
                    isLatest: true,
                    url: "https://www.esc.vic.gov.au/page",
                    downloadUrl:
                        "https://www.esc.vic.gov.au/sites/default/files/documents/ercop-v7.docx",
                },
            ],
            getEnergyText: async () => ({
                instrumentId: "esc:ercop",
                name: "Energy Retail Code of Practice",
                asAt: null,
                versionLabel: "version 7",
                start: "2026-10-01",
                end: null,
                url: "https://www.esc.vic.gov.au/sites/default/files/documents/ercop-v7.docx",
                clause: null,
                page: 1,
                pageCount: 1,
                text: "7 Application\nThis Code applies.",
                attribution: "ESC",
                retrievedVia: "official",
            }),
            markCurrent: async () => {
                throw new Error("should replace");
            },
            markUnconfirmed: async () => {
                throw new Error("should replace");
            },
            replace: async (id, next) => {
                replaced.push({
                    id,
                    versionLabel: next.versionLabel,
                    chars: next.fullText.length,
                });
            },
        });
        expect(results[0]).toMatchObject({
            action: "updated",
            versionLabel: "version 7",
        });
        expect(replaced).toEqual([
            {
                id: "row-1",
                versionLabel: "version 7",
                chars: "7 Application\nThis Code applies.".length,
            },
        ]);
    });

    it("keeps the held copy and marks it unconfirmed when the version list fails", async () => {
        const unconfirmed: string[] = [];
        const results = await refreshHeldLegalSources([HELD], {
            listEnergyVersions: async () => {
                throw new Error("ESC landing page timed out");
            },
            getEnergyText: async () => {
                throw new Error("should not download");
            },
            markCurrent: async () => {
                throw new Error("should not mark current");
            },
            markUnconfirmed: async (id) => {
                unconfirmed.push(id);
            },
            replace: async () => {
                throw new Error("should not replace");
            },
        });
        expect(results).toEqual([
            {
                instrumentId: "esc:ercop",
                family: "energy",
                action: "unconfirmed",
                versionLabel: "version 6",
                error: "ESC landing page timed out",
            },
        ]);
        expect(unconfirmed).toEqual(["row-1"]);
    });
});
