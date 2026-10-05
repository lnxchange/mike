import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ByokPage from "./page";

const profile = {
  apiKeys: {
    claude: { configured: true, source: "org" as const },
    gemini: { configured: false, source: null },
    openai: { configured: true, source: "user" as const },
    openrouter: { configured: false, source: null },
    vercel: { configured: false, source: null },
    "opencode-go": { configured: false, source: null },
    courtlistener: { configured: false, source: null },
  },
};

vi.mock("@/app/contexts/UserProfileContext", () => ({
  useUserProfile: () => ({
    profile,
    updateApiKey: vi.fn(async () => true),
  }),
}));

vi.mock("@/app/components/settings/RouterSettingsSection", () => ({
  RouterSettingsSection: () => null,
}));

describe("BYOK page", () => {
  it("explains when the organisation provides a key", () => {
    render(<ByokPage />);

    expect(
      screen.getByText(
        "Your organisation provides this key. Saving a personal key here overrides it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryAllByText(
        "Your organisation provides this key. Saving a personal key here overrides it.",
      ),
    ).toHaveLength(1);
  });
});
