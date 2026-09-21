import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthConfig, startMicrosoftOAuth } = vi.hoisted(() => ({
    getAuthConfig: vi.fn(),
    startMicrosoftOAuth: vi.fn(),
}));

vi.mock("@/app/lib/authApi", () => ({
    getAuthConfig,
    startMicrosoftOAuth,
}));

import { MicrosoftAuthButton } from "./MicrosoftAuthButton";

describe("MicrosoftAuthButton", () => {
    beforeEach(() => {
        getAuthConfig.mockReset();
        startMicrosoftOAuth.mockReset();
    });

    it("stays hidden when Microsoft OAuth is disabled", async () => {
        getAuthConfig.mockResolvedValue({ microsoftEnabled: false });
        render(<MicrosoftAuthButton onError={vi.fn()} />);
        expect(
            screen.queryByRole("button", { name: /microsoft/i }),
        ).not.toBeInTheDocument();
        await Promise.resolve();
        expect(
            screen.queryByRole("button", { name: /microsoft/i }),
        ).not.toBeInTheDocument();
    });

    it("starts Microsoft OAuth when enabled", async () => {
        getAuthConfig.mockResolvedValue({ microsoftEnabled: true });
        startMicrosoftOAuth.mockResolvedValue({
            url: "https://login.microsoftonline.test/authorize",
        });
        const assign = vi.fn();
        Object.defineProperty(window, "location", {
            value: { assign },
            writable: true,
        });
        render(<MicrosoftAuthButton onError={vi.fn()} />);
        const button = await screen.findByRole("button", {
            name: "Continue with Microsoft",
        });
        await userEvent.click(button);
        expect(startMicrosoftOAuth).toHaveBeenCalledWith("/onboarding/profile");
        expect(assign).toHaveBeenCalledWith(
            "https://login.microsoftonline.test/authorize",
        );
    });
});
