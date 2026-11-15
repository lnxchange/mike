import { fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@/app/components/shared/types";
import type { DocumentVersion } from "@/app/lib/mikeApi";
import { DocumentSidePanel } from "./DocumentSidePanel";

vi.mock("@/app/components/shared/views/PdfView", () => ({
    PdfView: () => <div>pdf-viewer</div>,
}));
vi.mock("@/app/components/shared/views/SpreadsheetView", () => ({
    SpreadsheetView: () => <div>sheet-viewer</div>,
}));
// One stand-in serves both suites: the viewer tests look for the label, and
// the dismissal test looks for a menu item portaled onto document.body.
vi.mock("@/app/components/shared/views/DocxView", () => ({
    DocxView: () => (
        <>
            <div>docx-viewer</div>
            {createPortal(
                <button type="button">Viewer menu item</button>,
                document.body,
            )}
        </>
    ),
}));

const baseDoc = {
    user_id: "user-1",
    project_id: "project-1",
    folder_id: null,
    owner_email: "sync@attune.legal",
    storage_path: "documents/u/doc/source.docx",
    size_bytes: 12,
    page_count: null,
    structure_tree: null,
    status: "ready",
    created_at: "2026-09-20T04:30:00.000Z",
} as const;

function document(overrides: Partial<Document>): Document {
    return {
        id: "doc-1",
        filename: "Letter.docx",
        file_type: "docx",
        pdf_storage_path: null,
        ...baseDoc,
        ...overrides,
    };
}

const noop = vi.fn();

function renderViewer(doc: Document) {
    return render(
        <DocumentSidePanel
            doc={doc}
            versions={[]}
            versionsLoading={false}
            onClose={noop}
            onLoadVersions={noop}
            onSelectVersion={noop}
            onDownloadDocument={noop}
            onDownloadVersion={noop}
            onRenameVersion={noop}
            onDeleteVersion={noop}
            onUploadNewVersion={noop}
            onReplaceVersion={noop}
            onDelete={noop}
        />,
    );
}

const agreement: Document = {
    id: "doc-1",
    user_id: "user-1",
    project_id: "project-1",
    filename: "agreement.docx",
    file_type: "docx",
    storage_path: "documents/agreement.docx",
    pdf_storage_path: null,
    size_bytes: 1024,
    page_count: null,
    structure_tree: null,
    status: "ready",
    created_at: "2026-09-27T00:00:00Z",
};

function renderPanel(
    onClose = vi.fn(),
    options: { readOnly?: boolean; versions?: DocumentVersion[] } = {},
) {
    render(
        <DocumentSidePanel
            doc={agreement}
            readOnly={options.readOnly ?? true}
            versions={options.versions ?? []}
            versionsLoading={false}
            onClose={onClose}
            onLoadVersions={vi.fn()}
            onSelectVersion={vi.fn()}
            onDownloadDocument={vi.fn()}
            onDownloadVersion={vi.fn()}
            onRenameVersion={vi.fn()}
            onDeleteVersion={vi.fn()}
            onUploadNewVersion={vi.fn()}
            onReplaceVersion={vi.fn()}
            onDelete={vi.fn()}
        />,
    );
    return onClose;
}

describe("DocumentSidePanel viewer", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("opens a Word file with a stored PDF rendition in PdfView", async () => {
        renderViewer(
            document({
                pdf_storage_path: "converted-pdfs/u/doc-1.pdf",
            }),
        );
        expect(await screen.findByText("pdf-viewer")).toBeInTheDocument();
        expect(screen.queryByText("docx-viewer")).toBeNull();
    });

    it("keeps Word without a rendition in DocxView", async () => {
        renderViewer(document({ pdf_storage_path: null }));
        expect(await screen.findByText("docx-viewer")).toBeInTheDocument();
        expect(screen.queryByText("pdf-viewer")).toBeNull();
    });

    it("opens a PDF in PdfView", async () => {
        renderViewer(
            document({
                filename: "Letter.pdf",
                file_type: "pdf",
                pdf_storage_path: "documents/u/doc/source.pdf",
            }),
        );
        expect(await screen.findByText("pdf-viewer")).toBeInTheDocument();
    });
});

it("stays open for portaled menus opened from the viewer, but closes on a real outside press", async () => {
    const onClose = renderPanel();
    fireEvent.pointerDown(
        await screen.findByRole("button", { name: "Viewer menu item" }),
    );
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
});

it("titles the document view and lists the latest version first", () => {
    const version = (n: number, createdAt: string): DocumentVersion => ({
        id: `v${n}`,
        version_number: n,
        source: "upload",
        created_at: createdAt,
        filename: `agreement-v${n}.docx`,
    });
    renderPanel(vi.fn(), {
        readOnly: false,
        // Out of order on purpose: the list must not rely on the API's order.
        versions: [
            version(1, "2026-09-01T00:00:00Z"),
            version(3, "2026-09-02T00:00:00Z"),
            version(2, "2026-09-03T00:00:00Z"),
        ],
    });

    expect(
        screen.getByRole("heading", { name: "agreement-v3.docx" }),
    ).toBeInTheDocument();
    expect(
        screen
            .getAllByRole("button", { name: /^Download Version/ })
            .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
        "Download Version 3",
        "Download Version 2",
        "Download Version 1",
    ]);
});
