import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/config");
});

describe("SiteLogo", () => {
    it("renders the Mike lockup when the profile has no wordmark", async () => {
        const { SiteLogo } = await import("./site-logo");
        render(<SiteLogo />);

        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
            "Mike",
        );
        expect(screen.queryByRole("img")).toBeNull();
    });

    it("renders the wordmark and qualifier when the profile supplies them", async () => {
        vi.doMock("@/config", () => ({
            appConfig: {
                branding: {
                    appName: "Libris Colleague",
                    landingUrl: "https://libris.au",
                    wordmarkSrc: "/brand/libris-logo-fullcolor.svg",
                    wordmarkSrcDark: "/brand/libris-logo-reverse.png",
                    wordmarkQualifier: "Colleague",
                },
            },
        }));
        const { SiteLogo } = await import("./site-logo");
        const { container } = render(<SiteLogo as="div" />);

        expect(container.querySelector("h1")).toBeNull();
        expect(screen.getByText("Colleague")).toBeInTheDocument();
        const images = container.querySelectorAll("img");
        expect(images[0]?.getAttribute("src")).toBe(
            "/brand/libris-logo-fullcolor.svg",
        );
        expect(images[0]?.getAttribute("alt")).toBe("Libris");
        expect(images[1]?.getAttribute("src")).toBe(
            "/brand/libris-logo-reverse.png",
        );
    });
});
