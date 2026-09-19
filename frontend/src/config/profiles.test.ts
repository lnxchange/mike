import { describe, expect, it } from "vitest";
import { ossProfile } from "./profiles/oss";
import { modeLawProfile } from "./profiles/mode-law";
import { librisColleagueProfile } from "./profiles/libris-colleague";
import { appConfig } from "./index";

describe("deployment profiles", () => {
    it("keeps the OSS terminology as the stock Mike wording", () => {
        expect(ossProfile.terminology).toEqual({
            project: "Project",
            projects: "Projects",
            projectLower: "project",
            projectsLower: "projects",
            referenceNumber: "CM number",
        });
        expect(modeLawProfile.terminology).toEqual(ossProfile.terminology);
        expect(ossProfile.branding.markSrc).toBeUndefined();
        expect(ossProfile.branding.iconSrc).toBeUndefined();
    });

    it("renames projects to matters for Libris Colleague", () => {
        expect(librisColleagueProfile.terminology).toEqual({
            project: "Matter",
            projects: "Matters",
            projectLower: "matter",
            projectsLower: "matters",
            referenceNumber: "Matter number",
        });
        expect(librisColleagueProfile.branding.markSrc).toBe(
            "/brand/libris-bookmark.svg",
        );
        expect(librisColleagueProfile.branding.iconSrc).toBe(
            "/brand/libris-bookmark.svg",
        );
    });

    it("resolves to the OSS profile when no profile is requested", () => {
        expect(appConfig.id).toBe("oss");
        expect(appConfig.terminology.project).toBe("Project");
    });
});
