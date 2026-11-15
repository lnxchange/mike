import { Profiler, useState, type ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastViewportUI, clearToasts } from "@mike/ui";
import { SelectionActionsMenu } from "@/app/components/shared/SelectionActionsMenu";
import type { Document } from "@/app/components/shared/types";
import {
    DocTable,
    documentHasEmailMeta,
    documentNeedsMetadataRefresh,
    type DocTableFolder,
    type DocTableSelectionActions,
} from "./DocTable";

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: "user-1" } }),
}));

const ORIGINAL_DATE = "2026-01-01T00:00:00.000Z";
const SERVER_DATE = "2026-02-01T00:00:00.000Z";
const allowAll = () => true;

function document(id: string, filename: string): Document {
    return {
        id,
        user_id: "user-1",
        project_id: "project-1",
        folder_id: "folder-1",
        filename,
        file_type: "pdf",
        storage_path: `${id}.pdf`,
        pdf_storage_path: null,
        size_bytes: 10,
        page_count: 1,
        structure_tree: null,
        status: "ready",
        created_at: ORIGINAL_DATE,
        updated_at: ORIGINAL_DATE,
    };
}

type DocTableOperations = ComponentProps<typeof DocTable>["operations"];

function operations(
    moveDocument: DocTableOperations["moveDocument"],
): DocTableOperations {
    return {
        uploadDocument: vi.fn(),
        refreshCollection: vi.fn().mockResolvedValue(undefined),
        createFolder: vi.fn(),
        resolveFolderPath: vi.fn(),
        renameFolder: vi.fn(),
        deleteFolder: vi.fn(),
        moveFolder: vi.fn(),
        moveDocument,
        renameDocument: vi.fn(),
    };
}

function Harness({
    initialDocuments,
    tableOperations,
    folders: initialFolders,
    folderViewId = "folder-1",
    enableHeaderFilters = false,
}: {
    initialDocuments: Document[];
    tableOperations: DocTableOperations;
    folders?: DocTableFolder[];
    folderViewId?: string | null;
    enableHeaderFilters?: boolean;
}) {
    const [documents, setDocuments] = useState(initialDocuments);
    const [folders, setFolders] = useState<DocTableFolder[]>(
        initialFolders ?? [
            {
                id: "folder-1",
                project_id: "project-1",
                user_id: "user-1",
                name: "Folder",
                parent_folder_id: null,
                created_at: ORIGINAL_DATE,
                updated_at: ORIGINAL_DATE,
            },
        ],
    );
    const [selectionActions, setSelectionActions] =
        useState<DocTableSelectionActions | null>(null);

    return (
        <>
            <ToastViewportUI />
            <output data-testid="documents-state">
                {JSON.stringify(documents)}
            </output>
            {selectionActions && (
                <SelectionActionsMenu renderItems={selectionActions.renderMenuItems} />
            )}
            <DocTable
                scopeKey="project-1"
                documents={documents}
                setDocuments={setDocuments}
                folders={folders}
                setFolders={setFolders}
                loading={false}
                search=""
                operations={tableOperations}
                emptyStateTitle="Documents"
                canDo={allowAll}
                folderViewId={folderViewId}
                onSelectionActionsChange={setSelectionActions}
                enableHeaderFilters={enableHeaderFilters}
            />
        </>
    );
}

describe("DocTable remove-from-folder failures", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearToasts();
    });

    it.each([1, 2])("matches toolbar and right-click actions for %i selected documents", async (count) => {
        const user = userEvent.setup();
        render(<Harness
            initialDocuments={[document("doc-1", "One.pdf"), document("doc-2", "Two.pdf")]}
            tableOperations={operations(vi.fn())}
        />);
        await user.click(screen.getByLabelText("Select One.pdf"));
        if (count === 2) await user.click(screen.getByLabelText("Select Two.pdf"));
        await user.click(screen.getByRole("button", { name: "Actions" }));
        const toolbarItems = screen.getAllByRole("menuitem").map((item) => item.textContent);
        expect(toolbarItems).toContain("Deselect rows");
        if (count === 1) expect(toolbarItems).toContain("Rename document");
        else expect(toolbarItems).toContain("Delete 2 items");
        await user.keyboard("{Escape}");
        fireEvent.contextMenu(screen.getByText("One.pdf"), { clientX: 40, clientY: 40 });
        expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(toolbarItems);
        await user.click(screen.getByRole("menuitem", { name: "Deselect rows" }));
        expect(screen.queryByRole("button", { name: "Actions" })).not.toBeInTheDocument();
    });

    it.each([false, true])("matches folder right-click actions for a mixed selection: %s", async (mixed) => {
        const user = userEvent.setup();
        render(<Harness
            initialDocuments={[{ ...document("doc-1", "One.pdf"), folder_id: null }]}
            tableOperations={operations(vi.fn())}
            folderViewId={null}
        />);
        await user.click(screen.getByLabelText("Select files in Folder"));
        if (mixed) await user.click(screen.getByLabelText("Select One.pdf"));
        await user.click(screen.getByRole("button", { name: "Actions" }));
        const toolbarItems = screen.getAllByRole("menuitem").map((item) => item.textContent);
        if (!mixed) {
            expect(toolbarItems).toContain("Open");
            expect(toolbarItems).toContain("Rename folder");
            expect(toolbarItems).toContain("New subfolder inside");
        } else expect(toolbarItems).toContain("Delete 2 items");
        await user.keyboard("{Escape}");
        fireEvent.contextMenu(screen.getByText("Folder"), { clientX: 40, clientY: 40 });
        expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(toolbarItems);
    });

    it("keeps focus in the rename field after a toolbar action", async () => {
        const user = userEvent.setup();
        const tableOperations = operations(vi.fn());
        render(<Harness initialDocuments={[document("doc-1", "One.pdf")]} tableOperations={tableOperations} />);
        await user.click(screen.getByLabelText("Select One.pdf"));
        await user.click(screen.getByRole("button", { name: "Actions" }));
        await user.click(screen.getByRole("menuitem", { name: "Rename document" }));
        const input = screen.getByDisplayValue("One.pdf");
        await waitFor(() => expect(input).toHaveFocus());
        expect(tableOperations.renameDocument).not.toHaveBeenCalled();
    });

    it("warns when removing one document fails", async () => {
        const user = userEvent.setup();
        const moveDocument = vi.fn().mockRejectedValue(new Error("failed"));
        const tableOperations = operations(moveDocument);
        render(
            <Harness
                initialDocuments={[document("doc-1", "One.pdf")]}
                tableOperations={tableOperations}
            />,
        );

        await user.click(screen.getByRole("button", { name: "Open row actions" }));
        await user.click(
            screen.getByRole("menuitem", { name: "Remove from subfolder" }),
        );

        expect(
            await screen.findByText(
                "Couldn't remove the document from its folder",
            ),
        ).toBeInTheDocument();
        expect(tableOperations.refreshCollection).toHaveBeenCalledOnce();
    });

    it("limits a large move to five active requests and eventually completes every row", async () => {
        let active = 0, peak = 0;
        const release: (() => void)[] = [];
        const move = vi.fn((id: string) => new Promise<Document>(resolve => {
            active++; peak = Math.max(peak, active);
            release.push(() => { active--; resolve({ ...document(id, `${id}.pdf`), folder_id: null }); });
        }));
        const docs = Array.from({length: 12}, (_, i) => document(String(i), `${i}.pdf`));
        render(<Harness initialDocuments={docs} tableOperations={operations(move)} />);
        const user = userEvent.setup();
        for (const doc of docs) await user.click(screen.getByLabelText(`Select ${doc.filename}`));
        await user.click(screen.getByRole("button", {name:"Actions"}));
        await user.click(screen.getByRole("menuitem", {name:"Remove from subfolder"}));
        expect(move).toHaveBeenCalledTimes(5);
        while (release.length) await act(async () => { release.shift()!(); await Promise.resolve(); });
        expect(move).toHaveBeenCalledTimes(12);
        expect(peak).toBe(5);
        expect(JSON.parse(screen.getByTestId("documents-state").textContent!).every((d: Document) => d.folder_id === null)).toBe(true);
    });

    it("applies a burst of per-file upload progress as one table update", async () => {
        // Frames are stepped by hand; the transfers still finish on real timers.
        vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
        try {
            const files = Array.from({ length: 20 }, (_, i) =>
                new File(["%PDF"], `Upload ${i}.pdf`, { type: "application/pdf" }),
            );
            let reported = 0;
            let finishBatch!: () => void;
            const batchHeld = new Promise<void>((resolve) => { finishBatch = resolve; });
            const uploadDocuments = vi.fn(async (
                inputs: Array<{ file: File; clientId: string }>,
                options?: { onProgress?: (progress: never) => void },
            ) => {
                // Each file finishes in its own task, as separate transfers do.
                const outcomes = await Promise.all(inputs.map(async ({ file, clientId }, i) => {
                    await new Promise((resolve) => setTimeout(resolve, 0));
                    const outcome = {
                        clientId, filename: file.name, status: "completed" as const,
                        result: document(`up-${i}`, file.name), errorCode: null,
                    };
                    options?.onProgress?.(outcome as never);
                    reported++;
                    return outcome;
                }));
                await batchHeld;
                return outcomes;
            });
            let commits = 0;
            const { container } = render(
                <Profiler id="table" onRender={() => { commits++; }}>
                    <Harness
                        initialDocuments={[]}
                        tableOperations={{ ...operations(vi.fn()), uploadDocuments }}
                    />
                </Profiler>,
            );
            const input = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1];
            commits = 0;
            fireEvent.change(input, { target: { files } });
            await waitFor(() => expect(reported).toBe(20));
            act(() => { vi.advanceTimersToNextFrame(); });

            // All twenty completions land in that one frame: the upload's
            // start plus one frame's update, not two renders of the whole
            // table per file (41 for these 20 files).
            expect(JSON.parse(screen.getByTestId("documents-state").textContent!)).toHaveLength(20);
            expect(commits).toBeLessThanOrEqual(3);
            await act(async () => { finishBatch(); });
        } finally {
            vi.useRealTimers();
        }
    });

    it("warns on partial bulk failure and merges successful server rows", async () => {
        const user = userEvent.setup();
        const moveDocument = vi.fn(async (id: string) => {
            if (id === "doc-2") throw new Error("failed");
            return {
                ...document(id, "One.pdf"),
                folder_id: null,
                updated_at: SERVER_DATE,
            };
        });
        const tableOperations = operations(moveDocument);
        render(
            <Harness
                initialDocuments={[
                    document("doc-1", "One.pdf"),
                    document("doc-2", "Two.pdf"),
                ]}
                tableOperations={tableOperations}
            />,
        );

        await user.click(screen.getByLabelText("Select One.pdf"));
        await user.click(screen.getByLabelText("Select Two.pdf"));
        await user.click(screen.getByRole("button", { name: "Actions" }));
        await user.click(screen.getByRole("menuitem", { name: "Remove from subfolder" }));

        expect(
            await screen.findByText(
                "Couldn't move the document out of its folder",
            ),
        ).toBeInTheDocument();
        await waitFor(() =>
            expect(screen.getByTestId("documents-state")).toHaveTextContent(
                SERVER_DATE,
            ),
        );
        expect(tableOperations.refreshCollection).toHaveBeenCalledOnce();
    });
});

describe("documentNeedsMetadataRefresh", () => {
    it("polls converting rows and ready Untitled documents", () => {
        expect(
            documentNeedsMetadataRefresh({
                status: "pending",
                filename: "Contract.pdf",
            }),
        ).toBe(true);
        expect(
            documentNeedsMetadataRefresh({
                status: "processing",
                filename: "Contract.pdf",
            }),
        ).toBe(true);
        expect(
            documentNeedsMetadataRefresh({
                status: "ready",
                filename: "Untitled document",
            }),
        ).toBe(true);
        expect(
            documentNeedsMetadataRefresh({
                status: "ready",
                filename: "Contract.pdf",
            }),
        ).toBe(false);
        expect(
            documentNeedsMetadataRefresh({
                status: "error",
                filename: "Untitled document",
            }),
        ).toBe(false);
    });
});

describe("DocTable virtual source folders", () => {
    it("omits created and updated dates on grouping rows", () => {
        render(
            <Harness
                initialDocuments={[]}
                tableOperations={operations(vi.fn())}
                folderViewId={null}
                folders={[
                    {
                        id: "source:personal",
                        user_id: "user-1",
                        library_kind: "file",
                        name: "Personal",
                        parent_folder_id: null,
                        created_at: null,
                        updated_at: null,
                        virtual: true,
                    },
                    {
                        id: "source:org-1",
                        user_id: "user-1",
                        org_id: "org-1",
                        library_kind: "file",
                        name: "Organisation",
                        parent_folder_id: null,
                        created_at: "1970-01-01T00:00:00.000Z",
                        updated_at: "1970-01-01T00:00:00.000Z",
                        virtual: true,
                    },
                ]}
            />,
        );

        expect(screen.getByText("Personal")).toBeInTheDocument();
        expect(screen.getByText("Organisation")).toBeInTheDocument();
        expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
        expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });
});

describe("DocTable email metadata columns", () => {
    it("shows arrived, from, to and subject when a row has correspondence fields", () => {
        const emailDoc = {
            ...document("doc-mail", "Notice.eml"),
            email_subject: "s155 notice",
            email_from: "accc@example.gov.au",
            email_to: "yule@attune.legal",
            email_received_at: "2026-03-01T03:00:00.000Z",
        };
        expect(documentHasEmailMeta(emailDoc)).toBe(true);
        render(
            <Harness
                initialDocuments={[emailDoc]}
                tableOperations={operations(vi.fn())}
            />,
        );
        expect(screen.getByText("Arrived")).toBeInTheDocument();
        expect(screen.getByText("From")).toBeInTheDocument();
        expect(screen.getByText("To")).toBeInTheDocument();
        expect(screen.getByText("Subject")).toBeInTheDocument();
        expect(screen.getByText("s155 notice")).toBeInTheDocument();
        expect(screen.getByText("accc@example.gov.au")).toBeInTheDocument();
        expect(screen.getByText("yule@attune.legal")).toBeInTheDocument();
    });

    it("orders correspondence rows from the arrived, from, to and subject headers", async () => {
        const user = userEvent.setup();
        const later = {
            ...document("doc-later", "Zeta.eml"),
            email_subject: "zeta notice",
            email_from: "zebra@example.gov.au",
            email_to: "zara@attune.legal",
            email_received_at: "2026-03-02T03:00:00.000Z",
        };
        const earlier = {
            ...document("doc-earlier", "Alpha.eml"),
            email_subject: "alpha notice",
            email_from: "accc@example.gov.au",
            email_to: "alex@attune.legal",
            email_received_at: "2026-03-01T03:00:00.000Z",
        };
        render(
            <Harness
                initialDocuments={[later, earlier]}
                tableOperations={operations(vi.fn())}
                enableHeaderFilters
            />,
        );

        expect(screen.getByRole("button", { name: "Sort by arrived date" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Sort by from" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Sort by to" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Sort by subject" })).toBeInTheDocument();

        function filenameOrder() {
            const laterName = screen.getByText("Zeta.eml");
            const earlierName = screen.getByText("Alpha.eml");
            return laterName.compareDocumentPosition(earlierName) &
                Node.DOCUMENT_POSITION_FOLLOWING
                ? ["Zeta.eml", "Alpha.eml"]
                : ["Alpha.eml", "Zeta.eml"];
        }

        expect(filenameOrder()).toEqual(["Zeta.eml", "Alpha.eml"]);

        await user.click(screen.getByRole("button", { name: "Sort by from" }));
        await user.click(screen.getByRole("menuitem", { name: "Ascending" }));
        expect(filenameOrder()).toEqual(["Alpha.eml", "Zeta.eml"]);

        await user.click(screen.getByRole("button", { name: "Sort by to" }));
        await user.click(screen.getByRole("menuitem", { name: "Descending" }));
        expect(filenameOrder()).toEqual(["Zeta.eml", "Alpha.eml"]);

        await user.click(screen.getByRole("button", { name: "Sort by subject" }));
        await user.click(screen.getByRole("menuitem", { name: "Ascending" }));
        expect(filenameOrder()).toEqual(["Alpha.eml", "Zeta.eml"]);

        await user.click(screen.getByRole("button", { name: "Sort by arrived date" }));
        await user.click(screen.getByRole("menuitem", { name: "Ascending" }));
        expect(filenameOrder()).toEqual(["Alpha.eml", "Zeta.eml"]);
    });
});

describe("DocTable SharePoint sync rows", () => {
    it("lists in-flight files and hides the upload empty state", () => {
        function SyncingTable() {
            const [documents, setDocuments] = useState<Document[]>([]);
            const [folders, setFolders] = useState<DocTableFolder[]>([]);
            return (
                <DocTable
                    scopeKey="project-1"
                    documents={documents}
                    setDocuments={setDocuments}
                    folders={folders}
                    setFolders={setFolders}
                    loading={false}
                    search=""
                    operations={operations(vi.fn())}
                    emptyStateTitle="Documents"
                    hideEmptyStateAction
                    canDo={allowAll}
                    syncFiles={[
                        {
                            id: "file-1",
                            filename: "Terms.pdf",
                            folderId: null,
                            stage: "processing",
                        },
                    ]}
                />
            );
        }

        render(<SyncingTable />);

        expect(screen.getByText("Terms.pdf")).toBeInTheDocument();
        expect(screen.getByRole("progressbar", { name: "Processing" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
    });
});

describe("DocTable empty state", () => {
    it("offers the secondary action beside Upload without opening the upload picker", async () => {
        const onClick = vi.fn();
        const openUpload = vi.fn();
        render(
            <DocTable
                scopeKey="templates"
                documents={[]}
                setDocuments={vi.fn()}
                folders={[]}
                setFolders={vi.fn()}
                loading={false}
                search=""
                operations={operations(vi.fn())}
                emptyStateTitle="Templates"
                emptyStateSecondaryAction={{ label: "Presets", onClick }}
                renderAddDocumentsModal={(open) => {
                    if (open) openUpload();
                    return null;
                }}
                canDo={allowAll}
            />,
        );

        expect(screen.getByRole("button", { name: "Upload" })).toBeVisible();
        await userEvent.click(screen.getByRole("button", { name: "Presets" }));

        expect(onClick).toHaveBeenCalledTimes(1);
        expect(openUpload).not.toHaveBeenCalled();
    });
});

describe("DocTable creator column", () => {
    it("shows each document's and folder's creator with their avatar", () => {
        const colleagueDoc = {
            ...document("doc-2", "Two.pdf"),
            folder_id: null,
            user_id: "user-2",
            owner_display_name: "Ada Lovelace",
            owner_profile_photo: "data:image/png;base64,AAAA",
        };
        render(
            <DocTable
                showCreator
                scopeKey="project-1"
                documents={[{ ...document("doc-1", "One.pdf"), folder_id: null }, colleagueDoc]}
                setDocuments={vi.fn()}
                folders={[{
                    id: "folder-1",
                    project_id: "project-1",
                    user_id: "user-2",
                    name: "Folder",
                    parent_folder_id: null,
                    owner_display_name: "Ada Lovelace",
                    created_at: ORIGINAL_DATE,
                    updated_at: ORIGINAL_DATE,
                }]}
                setFolders={vi.fn()}
                loading={false}
                search=""
                operations={operations(vi.fn())}
                emptyStateTitle="Documents"
                canDo={allowAll}
            />,
        );
        expect(screen.getByText("Creator")).toBeInTheDocument();
        expect(screen.getByText("Me")).toBeInTheDocument();
        const avatars = screen.getAllByRole("img", { name: "Ada Lovelace" });
        expect(avatars).toHaveLength(2);
        expect(avatars.some((avatar) => avatar.querySelector("img")?.getAttribute("src") === "data:image/png;base64,AAAA")).toBe(true);
    });
});

describe("DocTable creator filter", () => {
    it("narrows documents to the chosen creator", async () => {
        const user = userEvent.setup();
        render(
            <DocTable
                showCreator
                enableHeaderFilters
                scopeKey="project-1"
                documents={[
                    { ...document("doc-1", "One.pdf"), folder_id: null },
                    { ...document("doc-2", "Two.pdf"), folder_id: null, user_id: "user-2", owner_display_name: "Ada Lovelace" },
                ]}
                setDocuments={vi.fn()}
                folders={[]}
                setFolders={vi.fn()}
                loading={false}
                search=""
                operations={operations(vi.fn())}
                emptyStateTitle="Documents"
                canDo={allowAll}
            />,
        );
        await user.click(screen.getByRole("button", { name: "Filter by creator" }));
        await user.click(await screen.findByRole("button", { name: /Ada Lovelace/ }));
        expect(screen.getByText("Two.pdf")).toBeInTheDocument();
        expect(screen.queryByText("One.pdf")).toBeNull();
    });

    it("keeps the creator filter on refresh and clears it when switching scope", async () => {
        const user = userEvent.setup();
        const props: ComponentProps<typeof DocTable> = {
            showCreator: true,
            enableHeaderFilters: true,
            scopeKey: "project-1",
            documents: [
                { ...document("doc-1", "One.pdf"), folder_id: null },
                { ...document("doc-2", "Two.pdf"), folder_id: null, user_id: "user-2", owner_display_name: "Ada Lovelace" },
            ],
            setDocuments: vi.fn(),
            folders: [],
            setFolders: vi.fn(),
            loading: false,
            search: "",
            operations: operations(vi.fn()),
            emptyStateTitle: "Documents",
            canDo: allowAll,
        };
        const { rerender } = render(<DocTable {...props} />);
        await user.click(screen.getByRole("button", { name: "Filter by creator" }));
        await user.click(await screen.findByRole("button", { name: /Ada Lovelace/ }));

        rerender(<DocTable {...props} documents={[...props.documents]} />);
        expect(screen.getByText("Two.pdf")).toBeInTheDocument();
        expect(screen.queryByText("One.pdf")).not.toBeInTheDocument();

        rerender(<DocTable {...props} scopeKey="project-2" documents={[
            { ...document("doc-3", "Three.pdf"), project_id: "project-2", folder_id: null },
        ]} />);
        expect(screen.getByText("Three.pdf")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Filter by creator" })).toBeInTheDocument();
    });
});
