import { describe, expect, it } from "vitest";
import { excerptAround } from "../documents.textIndex";
import { textlessPageCount } from "../../../lib/pdfText";

describe("document text search helpers", () => {
    it("quotes the matching phrase with a little context", () => {
        const text = `${"a".repeat(100)}force majeure clause${"b".repeat(100)}`;
        const excerpt = excerptAround(text, "force majeure");
        expect(excerpt.startsWith("...")).toBe(true);
        expect(excerpt).toContain("force majeure clause");
        expect(excerpt.endsWith("...")).toBe(true);
    });

    it("counts pages named in a scanned-PDF notice", () => {
        expect(
            textlessPageCount(
                "This PDF has no text layer. It looks scanned, and none of its pages could be read (1-2). Do not invent its contents.",
            ),
        ).toBe(2);
        expect(
            textlessPageCount(
                "Pages without a text layer: 1, 3. Those pages could not be read.",
            ),
        ).toBe(2);
        expect(textlessPageCount("[Page 1]\nClause")).toBe(0);
    });
});
