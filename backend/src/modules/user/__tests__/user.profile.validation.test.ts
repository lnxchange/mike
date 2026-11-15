import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/supabase", () => ({ createServerSupabase: vi.fn() }));

import {
    validateOnboardingPayload,
    validateProfilePayload,
} from "../user.profile.validation";

describe("professional title validation", () => {
    it.each([
        "Principal",
        "Partner",
        "Special Counsel",
        "Senior Associate",
        "Associate",
        "Law Clerk",
        "Paralegal",
        "Counsel",
        "General Counsel",
        "Legal Counsel",
        "Other",
    ])("accepts %s during onboarding and profile updates", (title) => {
        const onboarding = validateOnboardingPayload({
            professionalTitle: title,
        });
        expect(onboarding).toEqual({
            ok: true,
            update: { professional_title: title },
        });

        const profile = validateProfilePayload({ professionalTitle: title });
        expect(profile.ok).toBe(true);
        if (profile.ok) {
            expect(profile.update.professional_title).toBe(title);
        }
    });

    it("rejects titles outside the allowed set", () => {
        expect(
            validateOnboardingPayload({ professionalTitle: "Attorney" }),
        ).toEqual({ ok: false, detail: "Select a valid title" });
        expect(validateProfilePayload({ professionalTitle: "Barrister" })).toEqual(
            { ok: false, detail: "Select a valid title" },
        );
    });
});
