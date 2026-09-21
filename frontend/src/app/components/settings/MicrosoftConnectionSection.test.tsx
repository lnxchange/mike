import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthConfig, useAuth } = vi.hoisted(() => ({
    getAuthConfig: vi.fn(),
    useAuth: vi.fn(),
}));

vi.mock("@/app/lib/authApi", () => ({
    getAuthConfig,
    startMicrosoftOAuth: vi.fn(),
}));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth,
}));

import { MicrosoftConnectionSection } from "./MicrosoftConnectionSection";

describe("MicrosoftConnectionSection", () => {
    beforeEach(() => {
        getAuthConfig.mockReset();
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
});
