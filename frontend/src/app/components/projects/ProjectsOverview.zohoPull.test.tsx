import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePaginatedProjects } from "@/app/hooks/usePaginatedProjects";
import { librisColleagueProfile } from "@/config/profiles/libris-colleague";
import { ProjectsOverview } from "./ProjectsOverview";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/projects",
}));
vi.mock("@/app/lib/mikeApi", () => ({
    deleteProject: vi.fn(async () => {}),
    setProjectMemoryEnabled: vi.fn(),
    updateProject: vi.fn(),
    getProjectFilterOptions: vi.fn(async () => ({
        practices: [],
        owners: [],
    })),
}));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: "me", email: "me@firm.test" } }),
}));
vi.mock("./NewProjectModal", () => ({ NewProjectModal: () => null }));
vi.mock("./ProjectDetailsModal", () => ({ ProjectDetailsModal: () => null }));
vi.mock("./PullMatterModal", () => ({
    PullMatterModal: ({ open }: { open: boolean }) =>
        open ? <div role="dialog">Pull from Zoho dialog</div> : null,
}));
vi.mock("@/app/hooks/usePaginatedProjects", () => ({
    usePaginatedProjects: vi.fn(),
}));
// The overview reads the flag at module load, so the profile is swapped for
// the whole file: this is the libris-colleague deployment's overview.
vi.mock("@/config", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/config")>();
    const { librisColleagueProfile: profile } = await import(
        "@/config/profiles/libris-colleague"
    );
    return { ...actual, appConfig: profile };
});

describe("ProjectsOverview with zohoMatterPull on", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(usePaginatedProjects).mockReturnValue({
            projects: [],
            setProjects: vi.fn(),
            loading: false,
            loadingMore: false,
            hasMore: false,
            error: null,
            loadMoreError: null,
            loadMore: vi.fn(),
            retry: vi.fn(),
            selectedProjectIds: [],
            setSelectedProjectIds: vi.fn(),
            selectAllMatching: vi.fn(),
            selectingAll: false,
            getProjectOwnerId: () => null,
        } as unknown as ReturnType<typeof usePaginatedProjects>);
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: true,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
    });

    it("is the profile that turns the flag on", () => {
        expect(librisColleagueProfile.featureFlags.zohoMatterPull).toBe(true);
    });

    it("shows matter number, client, and description on the list", () => {
        vi.mocked(usePaginatedProjects).mockReturnValue({
            projects: [
                {
                    id: "41cfbdbf-a1f8-47a2-be4d-1208eb375b0f",
                    user_id: "me",
                    name: "ACCC - s155 Notice and Enforcement",
                    cm_number: "242814",
                    client_name: "Blue NRG Pty Ltd",
                    description: "ACCC - s155 Notice and Enforcement",
                    practice: null,
                    memory_enabled: true,
                    created_at: "2026-01-01T00:00:00Z",
                    updated_at: "2026-01-01T00:00:00Z",
                    access_scope: "organization",
                    organization_name: "Attune Legal",
                },
            ],
            setProjects: vi.fn(),
            loading: false,
            loadingMore: false,
            hasMore: false,
            error: null,
            loadMoreError: null,
            loadMore: vi.fn(),
            retry: vi.fn(),
            selectedProjectIds: [],
            setSelectedProjectIds: vi.fn(),
            selectAllMatching: vi.fn(),
            selectingAll: false,
            getProjectOwnerId: () => null,
        } as unknown as ReturnType<typeof usePaginatedProjects>);

        render(<ProjectsOverview />);

        expect(screen.getByText("Matter number")).toBeInTheDocument();
        expect(screen.getByText("Client")).toBeInTheDocument();
        expect(screen.getByText("Description")).toBeInTheDocument();
        expect(screen.getByText("Zoho")).toBeInTheDocument();
        expect(screen.getByText("SharePoint")).toBeInTheDocument();
        expect(screen.getByText("242814")).toBeInTheDocument();
        expect(screen.getByText("Blue NRG Pty Ltd")).toBeInTheDocument();
        expect(
            screen.getAllByText("ACCC - s155 Notice and Enforcement").length,
        ).toBeGreaterThan(0);
        expect(screen.queryByRole("link", { name: "Zoho" })).not.toBeInTheDocument();
        expect(
            screen.queryByRole("link", { name: "SharePoint" }),
        ).not.toBeInTheDocument();
    });

    it("links out to Zoho and SharePoint when the matter has both fields", () => {
        vi.mocked(usePaginatedProjects).mockReturnValue({
            projects: [
                {
                    id: "41cfbdbf-a1f8-47a2-be4d-1208eb375b0f",
                    user_id: "me",
                    name: "ACCC - s155 Notice and Enforcement",
                    cm_number: "242814",
                    client_name: "Blue NRG Pty Ltd",
                    description: "ACCC - s155 Notice and Enforcement",
                    zoho_deal_id: "deal-1",
                    sharepoint_folder_url:
                        "https://attunelegal.sharepoint.com/sites/AttuneLegal/matter",
                    practice: null,
                    memory_enabled: true,
                    created_at: "2026-01-01T00:00:00Z",
                    updated_at: "2026-01-01T00:00:00Z",
                    access_scope: "organization",
                    organization_name: "Attune Legal",
                },
            ],
            setProjects: vi.fn(),
            loading: false,
            loadingMore: false,
            hasMore: false,
            error: null,
            loadMoreError: null,
            loadMore: vi.fn(),
            retry: vi.fn(),
            selectedProjectIds: [],
            setSelectedProjectIds: vi.fn(),
            selectAllMatching: vi.fn(),
            selectingAll: false,
            getProjectOwnerId: () => null,
        } as unknown as ReturnType<typeof usePaginatedProjects>);

        render(<ProjectsOverview />);

        const zoho = screen.getByRole("link", { name: "Zoho" });
        const sharepoint = screen.getByRole("link", { name: "SharePoint" });
        expect(zoho).toHaveAttribute(
            "href",
            "https://crm.zoho.com/crm/org684713976/tab/Potentials/deal-1",
        );
        expect(sharepoint).toHaveAttribute(
            "href",
            "https://attunelegal.sharepoint.com/sites/AttuneLegal/matter",
        );
        expect(zoho).toHaveAttribute("target", "_blank");
        expect(sharepoint).toHaveAttribute("target", "_blank");
    });

    it("offers Pull from Zoho beside New and opens the modal", async () => {
        const user = userEvent.setup();
        render(<ProjectsOverview />);

        const pull = screen.getByRole("button", { name: "Pull from Zoho" });
        expect(pull).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "New matter" }),
        ).toBeInTheDocument();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        await user.click(pull);

        expect(screen.getByRole("dialog")).toHaveTextContent(
            "Pull from Zoho dialog",
        );
    });
});
