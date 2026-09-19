import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/config");
});

describe("BrandMark", () => {
    it("renders the Mike icon when the profile has no mark", async () => {
        const { BrandMark } = await import("./brand-mark");
        const { container } = render(<BrandMark size={20} />);

        expect(container.querySelector("svg")).not.toBeNull();
        expect(container.querySelector("img")).toBeNull();
    });

    it("renders the profile mark image when markSrc is set", async () => {
        vi.doMock("@/config", () => ({
            appConfig: {
                branding: { markSrc: "/brand/test-mark.svg" },
            },
        }));
        const { BrandMark } = await import("./brand-mark");
        const { container } = render(<BrandMark size={24} spin />);

        const img = container.querySelector("img");
        expect(img).not.toBeNull();
        expect(img?.getAttribute("src")).toBe("/brand/test-mark.svg");
        expect(img?.getAttribute("aria-hidden")).toBe("true");
        expect(container.querySelector("svg")).toBeNull();
        expect(container.querySelector(".animate-pulse")).not.toBeNull();
    });
});
