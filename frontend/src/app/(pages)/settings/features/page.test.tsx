import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FeaturesPage from "./page";

const state = vi.hoisted(() => ({
    source: "env" as "env" | "user" | null,
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({
        profile: {
            legalResearchUs: true,
            legalResearchAu: false,
            legalResearchAuEnergy: false,
            legalResearchAuVic: false,
            legalResearchAuCases: false,
            quickActionsVisible: true,
            apiKeys: {
                courtlistener: {
                    configured: state.source !== null,
                    source: state.source,
                },
            },
        },
        updateApiKey: vi.fn(),
        updateLegalResearchUs: vi.fn(),
        updateLegalResearchAu: vi.fn(),
        updateLegalResearchAuEnergy: vi.fn(),
        updateLegalResearchAuVic: vi.fn(),
        updateLegalResearchAuCases: vi.fn(),
        updateQuickActionsVisible: vi.fn(),
    }),
}));

vi.mock("@/app/components/settings/ApiKeyField", () => ({
    ApiKeyField: ({ hasSavedKey }: { hasSavedKey: boolean }) => (
        <div data-testid="courtlistener-key-state">
            {hasSavedKey ? "personal" : "server-or-empty"}
        </div>
    ),
}));

describe("FeaturesPage CourtListener key", () => {
    beforeEach(() => {
        state.source = "env";
    });

    it("does not offer removal for a server-configured token", () => {
        render(<FeaturesPage />);
        expect(screen.getByTestId("courtlistener-key-state")).toHaveTextContent(
            "server-or-empty",
        );
    });

    it("marks a personal token as saved", () => {
        state.source = "user";
        render(<FeaturesPage />);
        expect(screen.getByTestId("courtlistener-key-state")).toHaveTextContent(
            "personal",
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
