import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { describeMatterSync } from "@/app/lib/matterSync";
import { ProjectPageHeader } from "./ProjectPageParts";

vi.mock("@/app/components/shared/PageHeader", () => ({
    PageHeader: ({
        actionGroups,
    }: {
        actionGroups?: Array<
            Array<{ type?: string; render?: React.ReactNode } | null>
        >;
    }) => (
        <div>
            {actionGroups?.flat().map((action, index) =>
                action?.type === "custom" ? (
                    <div key={index}>{action.render}</div>
                ) : null,
            )}
        </div>
    ),
}));

vi.mock("@/app/components/shared/HeaderActionsMenu", () => ({
    HeaderActionsMenu: ({
        items,
    }: {
        items: Array<{
            label: string;
            onSelect: () => void;
            disabled?: boolean;
        }>;
    }) => (
        <div>
            {items.map((item) => (
                <button
                    key={item.label}
                    disabled={item.disabled}
                    onClick={item.onSelect}
                >
                    {item.label}
                </button>
            ))}
        </div>
    ),
}));

vi.mock("@/app/components/shared/DocumentUploadMenu", () => ({
    DocumentUploadMenu: () => <button>Upload</button>,
}));

type MatterSyncProp = NonNullable<
    Parameters<typeof ProjectPageHeader>[0]["matterSync"]
>;

function renderHeader(matterSync: MatterSyncProp | null | undefined) {
    render(
        <ProjectPageHeader
            project={
                { id: "project-1", name: "Matter", cm_number: "263334" } as never
            }
            search=""
            activeSection="documents"
            creatingReview={false}
            canManageProject
            roleKnown
            onBackToProjects={vi.fn()}
            onProjectRoot={vi.fn()}
            onOpenDetails={vi.fn()}
            onOpenMemory={vi.fn()}
            onDeleteProject={vi.fn()}
            onSearchChange={vi.fn()}
            onOpenAccess={vi.fn()}
            onNewChat={vi.fn()}
            onNewReview={vi.fn()}
            matterSync={matterSync}
        />,
    );
}

describe("ProjectPageHeader matter sync", () => {
    it("shows nothing and offers no Sync now when the matter is not enrolled", () => {
        renderHeader(null);

        expect(screen.queryByText(/SharePoint/)).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Sync now" }),
        ).not.toBeInTheDocument();
    });

    it("renders the plain-text progress line and a working Sync now item", async () => {
        const user = userEvent.setup();
        const onSyncNow = vi.fn();
        renderHeader({
            statusLine: "Syncing from SharePoint, 34 documents so far, 86 to go",
            onSyncNow,
            syncing: false,
        });

        expect(
            screen.getByText(
                "Syncing from SharePoint, 34 documents so far, 86 to go",
            ),
        ).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Sync now" }));
        expect(onSyncNow).toHaveBeenCalledTimes(1);
    });

    it("disables Sync now while a sync is already running", () => {
        renderHeader({
            statusLine: "Waiting for the SharePoint folder",
            onSyncNow: vi.fn(),
            syncing: true,
        });

        expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled();
    });
});

describe("describeMatterSync", () => {
    const base = {
        found: true as const,
        matterNumber: "263334",
        matterName: "Intellihub - VAPs",
        lastSyncAt: null,
        lastChangeAt: null,
        lastError: null,
    };

    it("words each status for the header", () => {
        expect(describeMatterSync(null)).toBeNull();
        expect(describeMatterSync({ found: false })).toBeNull();
        expect(
            describeMatterSync({
                ...base,
                status: "Syncing",
                documentCount: 34,
                remaining: 86,
            }),
        ).toBe("Syncing from SharePoint, 34 documents so far, 86 to go");
        expect(
            describeMatterSync({
                ...base,
                status: "Syncing",
                documentCount: 1,
                remaining: 0,
            }),
        ).toBe("Syncing from SharePoint, 1 document so far");
        expect(
            describeMatterSync({
                ...base,
                status: "AwaitingFolder",
                documentCount: 0,
                remaining: 0,
            }),
        ).toBe("Waiting for the SharePoint folder");
        expect(
            describeMatterSync({
                ...base,
                status: "Idle",
                documentCount: 120,
                remaining: 0,
            }),
        ).toBe("Up to date with SharePoint");
        expect(
            describeMatterSync({
                ...base,
                status: "Paused",
                documentCount: 120,
                remaining: 0,
            }),
        ).toBe("Sync paused");
        for (const status of ["Failed", "TimedOut"] as const) {
            expect(
                describeMatterSync({
                    ...base,
                    status,
                    documentCount: 3,
                    remaining: 9,
                }),
            ).toBe("Sync failed, see Back Office");
        }
    });
});
