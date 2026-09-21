import { describe, expect, it } from "vitest";
import { fetchExaContents } from "../exaContents";

describe("Exa Contents fetch", () => {
    it("returns null when no API key is configured", async () => {
        expect(await fetchExaContents("https://example.test/act.pdf", {})).toBe(
            null,
        );
    });

    it("posts the official URL and returns useful text", async () => {
        const calls: Array<{ url: string; body: unknown }> = [];
        const result = await fetchExaContents(
            "https://www.legislation.sa.gov.au/nerl.pdf",
            { EXA_API_KEY: "exa-test" },
            async (url, init) => {
                calls.push({
                    url: String(url),
                    body: JSON.parse(String(init?.body ?? "{}")),
                });
                return Response.json({
                    results: [
                        {
                            url: "https://www.legislation.sa.gov.au/nerl.pdf",
                            title: "National Energy Retail Law",
                            text: `${"Section 5 Application. This Law applies to the sale of energy. ".repeat(8)}`,
                        },
                    ],
                });
            },
        );
        expect(calls[0]?.url).toBe("https://api.exa.ai/contents");
        expect(calls[0]?.body).toMatchObject({
            urls: ["https://www.legislation.sa.gov.au/nerl.pdf"],
            text: true,
            maxAgeHours: 0,
            livecrawlTimeout: 30_000,
        });
        expect(calls[0]?.body).not.toHaveProperty("livecrawl");
        expect(calls[0]?.body).not.toHaveProperty("highlights");
        expect(result?.text).toContain("This Law applies");
        expect(result?.url).toContain("legislation.sa.gov.au");
    });

    it("rejects a Cloudflare challenge body", async () => {
        const result = await fetchExaContents(
            "https://www.legislation.sa.gov.au/nerl.pdf",
            { EXA_API_KEY: "exa-test" },
            async () =>
                Response.json({
                    results: [
                        {
                            text: "<html><title>Just a moment...</title></html>",
                        },
                    ],
                }),
        );
        expect(result).toBeNull();
    });

    it("returns null when Exa reports an error status for the URL", async () => {
        const result = await fetchExaContents(
            "https://www.legislation.sa.gov.au/nerl.pdf",
            { EXA_API_KEY: "exa-test" },
            async () =>
                Response.json({
                    results: [],
                    statuses: [
                        {
                            id: "https://www.legislation.sa.gov.au/nerl.pdf",
                            status: "error",
                        },
                    ],
                }),
        );
        expect(result).toBeNull();
    });
});
