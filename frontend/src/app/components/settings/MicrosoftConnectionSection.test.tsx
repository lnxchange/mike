import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthConfig, startMicrosoftOAuth, useAuth } = vi.hoisted(() => ({
    getAuthConfig: vi.fn(),
    startMicrosoftOAuth: vi.fn(),
    useAuth: vi.fn(),
}));

vi.mock("@/app/lib/authApi", () => ({
    getAuthConfig,
    startMicrosoftOAuth,
}));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth,
}));

import { MicrosoftConnectionSection } from "./MicrosoftConnectionSection";

describe("MicrosoftConnectionSection", () => {
    beforeEach(() => {
        getAuthConfig.mockReset();
        startMicrosoftOAuth.mockReset();
        useAuth.mockReset();
        useAuth.mockReturnValue({
            user: {
                id: "user-1",
                email: "lawyer@example.test",
                pendingEmail: null,
                createdWithGoogle: false,
                microsoftConnected: true,
            },
            refreshSession: vi.fn(),
        });
    });

    it("hides when Microsoft OAuth is disabled", async () => {
        getAuthConfig.mockResolvedValue({ microsoftEnabled: false });
        const { container } = render(<MicrosoftConnectionSection />);
        await Promise.resolve();
        expect(container).toBeEmptyDOMElement();
    });

    it("shows a connected Microsoft row", async () => {
        getAuthConfig.mockResolvedValue({ microsoftEnabled: true });
        render(<MicrosoftConnectionSection />);
        expect(await screen.findByText("Connected")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Disconnect" }),
        ).toBeInTheDocument();
    });

    it("starts a Microsoft sign-in from Connect", async () => {
        getAuthConfig.mockResolvedValue({ microsoftEnabled: true });
        useAuth.mockReturnValue({
            user: {
                id: "user-1",
                email: "lawyer@example.test",
                pendingEmail: null,
                createdWithGoogle: false,
                microsoftConnected: false,
            },
            refreshSession: vi.fn(),
        });
        startMicrosoftOAuth.mockResolvedValue({
            url: "https://login.microsoftonline.test/authorize",
        });
        const assign = vi.fn();
        Object.defineProperty(window, "location", {
            value: { assign },
            writable: true,
        });

        render(<MicrosoftConnectionSection />);
        await userEvent.click(
            await screen.findByRole("button", { name: "Connect" }),
        );

        expect(startMicrosoftOAuth).toHaveBeenCalledWith("/settings/security");
        expect(assign).toHaveBeenCalledWith(
            "https://login.microsoftonline.test/authorize",
        );
    });
});
