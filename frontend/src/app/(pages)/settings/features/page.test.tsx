import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import FeaturesPage from "./page";

const state = vi.hoisted(() => ({
    updateResponseDetailsVisible: vi.fn(),
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({
        profile: {
            legalResearchAu: false,
            legalResearchAuEnergy: false,
            legalResearchAuVic: false,
            legalResearchAuCases: false,
            quickActionsVisible: true,
        },
        updateLegalResearchAu: vi.fn(),
        updateLegalResearchAuEnergy: vi.fn(),
        updateLegalResearchAuVic: vi.fn(),
        updateLegalResearchAuCases: vi.fn(),
        updateQuickActionsVisible: vi.fn(),
        updateResponseDetailsVisible: state.updateResponseDetailsVisible,
    }),
}));

vi.mock("@/app/components/settings/WebSearchSection", () => ({
    WebSearchSection: () => null,
}));

describe("FeaturesPage CourtListener", () => {
    it("is managed from Connectors, not here", () => {
        render(<FeaturesPage />);
        expect(screen.queryByText(/CourtListener/)).not.toBeInTheDocument();
    });
});

describe("FeaturesPage response details", () => {
    it("starts off and saves the user's choice", async () => {
        state.updateResponseDetailsVisible.mockResolvedValue(true);
        const user = userEvent.setup();
        render(<FeaturesPage />);

        const toggle = screen.getByRole("switch", { name: "Response details" });
        expect(toggle).toHaveAttribute("aria-checked", "false");
        await user.click(toggle);
        await waitFor(() =>
            expect(state.updateResponseDetailsVisible).toHaveBeenCalledWith(true),
        );
    });

    it("offers the Commonwealth legislation toggle without an API key field", () => {
        render(<FeaturesPage />);
        expect(
            screen.getByRole("switch", {
                name: "Australian legislation (Commonwealth)",
            }),
        ).toBeInTheDocument();
        expect(screen.queryByLabelText(/Federal Register API/i)).toBeNull();
    });

    it("offers the Australian energy law toggle without an API key field", () => {
        render(<FeaturesPage />);
        expect(
            screen.getByRole("switch", {
                name: "Australian energy law",
            }),
        ).toBeInTheDocument();
        expect(screen.queryByLabelText(/Energy API/i)).toBeNull();
        expect(screen.queryByLabelText(/AEMC API/i)).toBeNull();
    });

    it("offers the Victorian legislation toggle without an API key field", () => {
        render(<FeaturesPage />);
        expect(
            screen.getByRole("switch", {
                name: "Victorian legislation",
            }),
        ).toBeInTheDocument();
        expect(screen.queryByLabelText(/Victorian legislation API/i)).toBeNull();
    });

    it("offers the Australian case law toggle without an API key field", () => {
        render(<FeaturesPage />);
        expect(
            screen.getByRole("switch", {
                name: "Australian case law",
            }),
        ).toBeInTheDocument();
        expect(screen.queryByLabelText(/Caselaw API/i)).toBeNull();
    });
});
