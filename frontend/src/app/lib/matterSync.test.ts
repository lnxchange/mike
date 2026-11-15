import { describe, expect, it, vi } from "vitest";

vi.mock("@/config", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/config")>();
    const { librisColleagueProfile } = await import(
        "@/config/profiles/libris-colleague"
    );
    return { ...actual, appConfig: librisColleagueProfile };
});

import { sharepointFolderUrl, zohoMatterUrl } from "./matterSync";

describe("matter external URLs", () => {
    it("builds the Zoho Deal URL from the profile base", () => {
        expect(zohoMatterUrl(" deal-1 ")).toBe(
            "https://crm.zoho.com/crm/org684713976/tab/Potentials/deal-1",
        );
    });

    it("returns null without a Deal id", () => {
        expect(zohoMatterUrl(null)).toBeNull();
        expect(zohoMatterUrl("")).toBeNull();
    });

    it("accepts an http(s) SharePoint folder URL", () => {
        expect(
            sharepointFolderUrl(
                " https://attunelegal.sharepoint.com/sites/x ",
            ),
        ).toBe("https://attunelegal.sharepoint.com/sites/x");
    });

    it("rejects a non-http SharePoint value", () => {
        expect(sharepointFolderUrl("javascript:alert(1)")).toBeNull();
        expect(sharepointFolderUrl("not-a-url")).toBeNull();
    });
});
