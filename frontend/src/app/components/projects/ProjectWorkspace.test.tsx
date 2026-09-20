import { useEffect } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProject } from "@/app/lib/mikeApi";
import {
    ProjectSectionToolbar,
    ProjectWorkspaceProvider,
    useProjectWorkspace,
} from "./ProjectWorkspace";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn() }),
    useSelectedLayoutSegments: () => [],
}));

vi.mock("@/app/lib/mikeApi", () => ({
    createTabularReview: vi.fn(),
    deleteProject: vi.fn(),
    getProject: vi.fn(() => new Promise(() => {})),
    getProjectAccess: vi.fn(),
    getProjectPeople: vi.fn(),
    listProjectChats: vi.fn(),
    pullZohoMatter: vi.fn(),
    setProjectMemoryEnabled: vi.fn(),
    updateProject: vi.fn(),
}));

vi.mock("@/app/hooks/useMatterSyncStatus", () => ({
    useMatterSyncStatus: () => ({
        status: null,
        loaded: true,
        refresh: vi.fn(),
    }),
}));

vi.mock("@/config", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/config")>();
    const { librisColleagueProfile } = await import(
        "@/config/profiles/libris-colleague"
    );
    return { ...actual, appConfig: librisColleagueProfile };
});

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: "user-1", email: "user@example.com" } }),
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({ profile: { displayName: "User" } }),
}));

vi.mock("@/app/contexts/ChatHistoryContext", () => ({
    useChatHistoryContext: () => ({ saveChat: vi.fn() }),
}));

vi.mock("./ProjectPageParts", () => ({
    ProjectPageHeader: ({
        onUploadFiles,
    }: {
        onUploadFiles?: (() => void) | null;
    }) => <button disabled={!onUploadFiles}>Upload</button>,
}));

vi.mock("@/app/components/tabular/NewTRModal", () => ({
    NewTRModal: () => null,
}));
vi.mock("@/app/components/popups/ConfirmPopup", () => ({
    ConfirmPopup: () => null,
}));
vi.mock("@/app/components/popups/OwnerOnlyPopup", () => ({
    OwnerOnlyPopup: () => null,
}));
vi.mock("@/app/components/modals/AccessModal", () => ({
    AccessModal: () => null,
}));
vi.mock("./ProjectDetailsModal", () => ({
    ProjectDetailsModal: () => null,
}));

const uploadFiles = vi.fn();

function RegisterUploadAction() {
    const { setDocumentUploadHeaderAction } = useProjectWorkspace();

    useEffect(() => {
        setDocumentUploadHeaderAction("uploadFiles", uploadFiles);
        return () => setDocumentUploadHeaderAction("uploadFiles", null);
    }, [setDocumentUploadHeaderAction]);

    return null;
}

describe("ProjectWorkspaceProvider", () => {
    beforeEach(() => {
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

    it("keeps document upload actions registered on direct project load", async () => {
        render(
            <ProjectWorkspaceProvider projectId="project-1">
                <RegisterUploadAction />
            </ProjectWorkspaceProvider>,
        );

        expect(
            await screen.findByRole("button", { name: "Upload" }),
        ).toBeEnabled();
    });

    it("shows Zoho and SharePoint pills next to the section tabs", async () => {
        vi.mocked(getProject).mockResolvedValue({
            id: "project-1",
            user_id: "user-1",
            name: "ACCC - s155 Notice and Enforcement",
            cm_number: "242814",
            zoho_deal_id: "deal-1",
            sharepoint_folder_url:
                "https://attunelegal.sharepoint.com/sites/AttuneLegal/matter",
            practice: null,
            memory_enabled: true,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
        });

        render(
            <ProjectWorkspaceProvider projectId="project-1">
                <ProjectSectionToolbar />
            </ProjectWorkspaceProvider>,
        );

        expect(
            await screen.findByRole("link", { name: "Zoho" }),
        ).toHaveAttribute(
            "href",
            "https://crm.zoho.com/crm/org684713976/tab/Potentials/deal-1",
        );
        expect(screen.getByRole("link", { name: "SharePoint" })).toHaveAttribute(
            "href",
            "https://attunelegal.sharepoint.com/sites/AttuneLegal/matter",
        );
        expect(screen.getByRole("button", { name: "Documents" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Chats" })).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Tabular Reviews" }),
        ).toBeInTheDocument();
    });

    it("hides Zoho and SharePoint pills when the matter has no links", async () => {
        vi.mocked(getProject).mockResolvedValue({
            id: "project-1",
            user_id: "user-1",
            name: "Manual matter",
            cm_number: null,
            practice: null,
            memory_enabled: true,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
        });

        render(
            <ProjectWorkspaceProvider projectId="project-1">
                <ProjectSectionToolbar />
            </ProjectWorkspaceProvider>,
        );

        expect(
            await screen.findByRole("button", { name: "Documents" }),
        ).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Zoho" })).not.toBeInTheDocument();
        expect(
            screen.queryByRole("link", { name: "SharePoint" }),
        ).not.toBeInTheDocument();
    });
});
