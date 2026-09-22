import { useState, type ComponentProps } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
            <output data-testid="documents-state">
                {JSON.stringify(documents)}
            </output>
            <button
                type="button"
                disabled={!selectionActions}
                onClick={() => void selectionActions?.onRemoveFromFolder()}
            >
                Remove selected
            </button>
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
            screen.getByRole("button", { name: "Remove from subfolder" }),
        );

        expect(
            await screen.findByText(
                "The document could not be removed from its folder. Please try again.",
            ),
        ).toBeInTheDocument();
        expect(tableOperations.refreshCollection).toHaveBeenCalledOnce();
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
        await user.click(screen.getByRole("button", { name: "Remove selected" }));

        expect(
            await screen.findByText(
                "A document could not be removed from its folder. Please try again.",
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
