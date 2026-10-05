import { describe, expect, it } from "vitest";
import {
    inspectOfficialSourceError,
    looksLikeBotChallenge,
    officialSourceToolFailure,
    officialSourceUnavailableMessage,
} from "../officialSourceAccess";

describe("official source access", () => {
    it("treats a 403 with a user-facing message as unavailable", () => {
        const err = Object.assign(new Error("blocked"), {
            kind: "unavailable",
            status: 403,
            officialUrl: "https://www.legislation.sa.gov.au/example",
        });
        expect(inspectOfficialSourceError(err)).toEqual({
            userMessage: "blocked",
            officialUrl: "https://www.legislation.sa.gov.au/example",
        });
    });

    it("does not treat a missing clause as an access failure", () => {
        const err = Object.assign(new Error("Clause 5 was not found."), {
            kind: "not_found",
            status: 404,
        });
        expect(inspectOfficialSourceError(err)).toBeNull();
    });

    it("detects a Cloudflare challenge body", () => {
        expect(
            looksLikeBotChallenge(
                Buffer.from("<html><title>Just a moment...</title></html>"),
            ),
        ).toBe(true);
        expect(looksLikeBotChallenge(Buffer.from("%PDF-1.7"))).toBe(false);
    });

    it("asks the model to stop and request an upload", () => {
        const err = Object.assign(
            new Error(
                officialSourceUnavailableMessage({
                    name: "National Energy Retail Law",
                    site: "legislation.sa.gov.au",
                }),
            ),
            { kind: "unavailable", status: 403 },
        );
        const failure = officialSourceToolFailure(err, "fallback");
        expect(failure.safeToDisplay).toBe(true);
        expect(failure.error).toContain("National Energy Retail Law");
        expect(JSON.parse(failure.content)).toMatchObject({
            unavailable: true,
            legal_source_id: null,
            next_required_action: expect.stringContaining("legal_source_id"),
        });
    });

    it("passes through a legal-source ask id", () => {
        const err = Object.assign(new Error("blocked"), {
            kind: "unavailable",
            status: 403,
        });
        const failure = officialSourceToolFailure(err, "fallback", {
            legalSourceId: "legal-source:energy:sa:nerl",
        });
        expect(JSON.parse(failure.content)).toMatchObject({
            unavailable: true,
            legal_source_id: "legal-source:energy:sa:nerl",
        });
    });
});
