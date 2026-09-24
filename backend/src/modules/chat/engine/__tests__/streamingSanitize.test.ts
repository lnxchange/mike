import { describe, expect, it } from "vitest";
import { sanitizeAssistantSseChunk } from "../streaming";

describe("sanitizeAssistantSseChunk", () => {
    it("keeps an official-source access failure that is safe to display", () => {
        const event = {
            type: "au_get_energy",
            title_id: "sa:nerl",
            section: "5",
            error:
                "I could not download the official text of National Energy Retail Law (legislation.sa.gov.au).",
            safe_to_display: true,
        };
        const chunk = sanitizeAssistantSseChunk(
            `data: ${JSON.stringify(event)}\n\n`,
        );
        expect(JSON.parse(chunk.slice(6))).toMatchObject({
            error: event.error,
            safe_to_display: true,
        });
    });

    it("strips an internal tool error", () => {
        const chunk = sanitizeAssistantSseChunk(
            `data: ${JSON.stringify({
                type: "au_get_energy",
                title_id: "esc:ercop",
                error: "Unexpected token in PDF parser",
            })}\n\n`,
        );
        expect(JSON.parse(chunk.slice(6)).error).toBe(
            "This tool could not complete its request.",
        );
    });
});
