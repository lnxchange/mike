import { describe, expect, it } from "vitest";
import {
    parseLegalSourceAskId,
    persistLegalSourceUploads,
    resolveLegalSourceText,
    type LegalSourceRecord,
    type LegalSourceStore,
    type LegalSourceUpsert,
} from "../legalSourceStore";

function memoryStore(seed: LegalSourceRecord[] = []): LegalSourceStore {
    const rows = [...seed];
    return {
        async lookup(family, instrumentId, versionLabel) {
            return (
                rows.find(
                    (row) =>
                        row.family === family &&
                        row.instrumentId === instrumentId &&
                        row.versionLabel === (versionLabel ?? null),
                ) ?? null
            );
        },
        async lookupLatest(family, instrumentId) {
            return (
                rows.find(
                    (row) =>
                        row.family === family &&
                        row.instrumentId === instrumentId,
                ) ?? null
            );
        },
        async upsert(row: LegalSourceUpsert) {
            const next: LegalSourceRecord = {
                id: `${row.family}:${row.instrumentId}:${row.versionLabel ?? ""}`,
                family: row.family,
                instrumentId: row.instrumentId,
                name: row.name,
                versionLabel: row.versionLabel ?? null,
                officialUrl: row.officialUrl,
                retrievedVia: row.retrievedVia,
                currencyStatus: row.currencyStatus ?? "current",
                fullText: row.fullText,
            };
            const index = rows.findIndex((item) => item.id === next.id);
            if (index >= 0) rows[index] = next;
            else rows.push(next);
            return next;
        },
        async touch() {},
        async update(id, patch) {
            const index = rows.findIndex((item) => item.id === id);
            if (index < 0) return null;
            const current = rows[index]!;
            const next: LegalSourceRecord = {
                ...current,
                name: patch.name ?? current.name,
                versionLabel:
                    patch.versionLabel !== undefined
                        ? patch.versionLabel
                        : current.versionLabel,
                officialUrl: patch.officialUrl ?? current.officialUrl,
                retrievedVia: patch.retrievedVia ?? current.retrievedVia,
                currencyStatus: patch.currencyStatus ?? current.currencyStatus,
                fullText: patch.fullText ?? current.fullText,
            };
            rows[index] = next;
            return next;
        },
    };
}

describe("legal source ask ids", () => {
    it("parses family and instrument id", () => {
        expect(parseLegalSourceAskId("legal-source:energy:sa:nerl")).toEqual({
            family: "energy",
            instrumentId: "sa:nerl",
        });
        expect(parseLegalSourceAskId("legal-source:case_law:nsw:abc")).toEqual({
            family: "case_law",
            instrumentId: "nsw:abc",
        });
        expect(parseLegalSourceAskId("documents-please")).toBeNull();
    });
});

describe("resolveLegalSourceText", () => {
    it("reuses a held copy that matches the listed version", async () => {
        const store = memoryStore([
            {
                id: "held",
                family: "energy",
                instrumentId: "sa:nerl",
                name: "National Energy Retail Law",
                versionLabel: "current",
                officialUrl: "https://www.legislation.sa.gov.au/nerl.pdf",
                retrievedVia: "official",
                currencyStatus: "current",
                fullText: "5 Application\nThis Law applies to the sale of energy.",
            },
        ]);
        const loaded = await resolveLegalSourceText({
            store,
            family: "energy",
            instrumentId: "sa:nerl",
            name: "National Energy Retail Law",
            versionLabel: "current",
            officialUrl: "https://www.legislation.sa.gov.au/nerl.pdf",
            fetchOfficial: async () => {
                throw new Error("should not download");
            },
        });
        expect(loaded.retrievedVia).toBe("store");
        expect(loaded.currencyStatus).toBe("current");
        expect(loaded.fullText).toContain("This Law applies");
    });

    it("falls back to Exa after an official access failure and stores the text", async () => {
        const store = memoryStore();
        const loaded = await resolveLegalSourceText({
            store,
            family: "energy",
            instrumentId: "sa:nerl",
            name: "National Energy Retail Law",
            versionLabel: "current",
            officialUrl: "https://www.legislation.sa.gov.au/nerl.pdf",
            fetchOfficial: async () => {
                throw Object.assign(new Error("blocked"), {
                    kind: "unavailable",
                    status: 403,
                });
            },
            fetchExa: async () => ({
                text: "5 Application\nThis Law applies to the sale of energy to small customers.",
                url: "https://www.legislation.sa.gov.au/nerl.pdf",
                title: "NERL",
            }),
        });
        expect(loaded.retrievedVia).toBe("exa");
        const held = await store.lookup("energy", "sa:nerl", "current");
        expect(held?.retrievedVia).toBe("exa");
        expect(held?.fullText).toContain("small customers");
    });

    it("uses an older held copy when official and Exa both miss", async () => {
        const store = memoryStore([
            {
                id: "old",
                family: "energy",
                instrumentId: "sa:nerl",
                name: "National Energy Retail Law",
                versionLabel: "2012",
                officialUrl: "https://www.legislation.sa.gov.au/nerl.pdf",
                retrievedVia: "upload",
                currencyStatus: "unconfirmed",
                fullText: "Held compilation of the Retail Law.",
            },
        ]);
        const loaded = await resolveLegalSourceText({
            store,
            family: "energy",
            instrumentId: "sa:nerl",
            name: "National Energy Retail Law",
            versionLabel: "current",
            officialUrl: "https://www.legislation.sa.gov.au/nerl.pdf",
            fetchOfficial: async () => {
                throw Object.assign(new Error("blocked"), {
                    kind: "unavailable",
                    status: 403,
                });
            },
            fetchExa: async () => null,
        });
        expect(loaded.retrievedVia).toBe("store");
        expect(loaded.currencyStatus).toBe("unconfirmed");
        expect(loaded.fullText).toContain("Held compilation");
    });
});

describe("persistLegalSourceUploads", () => {
    it("stores uploaded text against the legal-source ask id", async () => {
        const store = memoryStore();
        const stored = await persistLegalSourceUploads({
            store,
            items: [
                {
                    id: "legal-source:energy:sa:nerl",
                    kind: "documents",
                    filenames: ["NERL.pdf"],
                },
            ],
            documents: [
                {
                    filename: "NERL.pdf",
                    text: "National Energy Retail Law\n5 Application\nThis Law applies.",
                },
            ],
        });
        expect(stored).toBe(1);
        const held = await store.lookup("energy", "sa:nerl", "uploaded");
        expect(held?.retrievedVia).toBe("upload");
        expect(held?.fullText).toContain("This Law applies");
    });
});
