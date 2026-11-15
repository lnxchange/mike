import { describe, expect, it } from "vitest";
import { settlePlanNotification } from "./planNotification";

describe("settlePlanNotification", () => {
    it("stays quiet while the tab is visible", () => {
        expect(
            settlePlanNotification({
                hidden: false,
                permission: "granted",
                title: "AML meeting",
                reason: "finished",
                currentTitle: "Libris",
            }).mode,
        ).toBe("none");
    });

    it("raises a system notification when permission is granted and the tab is hidden", () => {
        expect(
            settlePlanNotification({
                hidden: true,
                permission: "granted",
                title: "AML meeting",
                reason: "finished",
                currentTitle: "Libris",
            }),
        ).toEqual({
            mode: "notification",
            title: "AML meeting",
            body: "The plan is finished.",
        });
    });

    it("prefixes the tab title for an answer or a stop when notifications are refused", () => {
        expect(
            settlePlanNotification({
                hidden: true,
                permission: "denied",
                title: "AML meeting",
                reason: "needs_input",
                currentTitle: "Libris",
            }).title,
        ).toBe("Needs an answer · Libris");
        expect(
            settlePlanNotification({
                hidden: true,
                permission: "unsupported",
                title: "AML meeting",
                reason: "stopped",
                currentTitle: "Libris",
            }).title,
        ).toBe("Stopped · Libris");
    });
});
