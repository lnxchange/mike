import { describe, expect, it } from "vitest";
import {
    pdfjsCdnAssetUrl,
    pdfjsStandardFontDataUrl,
    pdfjsWasmUrl,
} from "./highlightQuote";

describe("pdfjs asset URLs", () => {
    it("pins fonts and wasm to the loaded pdfjs-dist version", () => {
        expect(pdfjsCdnAssetUrl("6.3.289", "wasm/jbig2.wasm")).toBe(
            "https://unpkg.com/pdfjs-dist@6.3.289/wasm/jbig2.wasm",
        );
        expect(pdfjsStandardFontDataUrl("6.3.289")).toBe(
            "https://unpkg.com/pdfjs-dist@6.3.289/standard_fonts/",
        );
        expect(pdfjsWasmUrl("6.3.289")).toBe(
            "https://unpkg.com/pdfjs-dist@6.3.289/wasm/",
        );
        expect(pdfjsStandardFontDataUrl("6.3.289")).not.toContain("4.10.38");
    });
});
