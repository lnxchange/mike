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
