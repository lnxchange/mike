import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationApiKeysModal } from "./OrganizationApiKeysModal";

const mocks = vi.hoisted(() => ({
  getOrgApiKeyStatus: vi.fn(),
  getApiKeyStatus: vi.fn(),
  saveOrgApiKey: vi.fn(),
}));

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getOrgApiKeyStatus: mocks.getOrgApiKeyStatus,
  getApiKeyStatus: mocks.getApiKeyStatus,
  saveOrgApiKey: mocks.saveOrgApiKey,
}));

vi.mock("@/app/components/popups/MfaVerificationPopup", () => ({
  MfaVerificationPopup: () => null,
  needsMfaVerification: vi.fn(async () => false),
}));

const emptyStatus = {
  claude: false,
  gemini: false,
  openai: false,
  openrouter: false,
  vercel: false,
  "opencode-go": false,
  courtlistener: false,
  sources: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrgApiKeyStatus.mockResolvedValue({ ...emptyStatus });
  mocks.getApiKeyStatus.mockResolvedValue({
    ...emptyStatus,
    claude: true,
    sources: { claude: "user" },
  });
  mocks.saveOrgApiKey.mockResolvedValue({
    ...emptyStatus,
    claude: true,
  });
});

describe("OrganizationApiKeysModal", () => {
  it("lets an admin copy their personal key onto the organisation", async () => {
    const user = userEvent.setup();
    render(
      <OrganizationApiKeysModal
        open
        orgId="org-1"
        orgName="Acme LLP"
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Use my personal key" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use my personal key" }));

    await waitFor(() =>
      expect(mocks.saveOrgApiKey).toHaveBeenCalledWith(
        "org-1",
        "claude",
        null,
        { usePersonal: true },
      ),
    );
  });

  it("does not offer a copy when the organisation already has the key", async () => {
    mocks.getOrgApiKeyStatus.mockResolvedValue({
      ...emptyStatus,
      claude: true,
    });
    render(
      <OrganizationApiKeysModal
        open
        orgId="org-1"
        orgName="Acme LLP"
        onClose={vi.fn()}
      />,
    );

    await screen.findByLabelText("Anthropic (Claude) API Key");
    expect(
      screen.queryByRole("button", { name: "Use my personal key" }),
    ).not.toBeInTheDocument();
  });
});
