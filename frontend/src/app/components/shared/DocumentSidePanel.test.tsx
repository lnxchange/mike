import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@/app/components/shared/types";
import { DocumentSidePanel } from "./DocumentSidePanel";

vi.mock("@/app/components/shared/views/PdfView", () => ({
    PdfView: () => <div>pdf-viewer</div>,
}));
vi.mock("@/app/components/shared/views/DocxView", () => ({
    DocxView: () => <div>docx-viewer</div>,
}));
vi.mock("@/app/components/shared/views/SpreadsheetView", () => ({
    SpreadsheetView: () => <div>sheet-viewer</div>,
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

function renderPanel(doc: Document) {
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

describe("DocumentSidePanel viewer", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("opens a Word file with a stored PDF rendition in PdfView", async () => {
        renderPanel(
            document({
                pdf_storage_path:
                    "converted-pdfs/u/doc-1.pdf",
            }),
        );
        expect(await screen.findByText("pdf-viewer")).toBeInTheDocument();
        expect(screen.queryByText("docx-viewer")).toBeNull();
    });

    it("keeps Word without a rendition in DocxView", async () => {
        renderPanel(document({ pdf_storage_path: null }));
        expect(await screen.findByText("docx-viewer")).toBeInTheDocument();
        expect(screen.queryByText("pdf-viewer")).toBeNull();
    });

    it("opens a PDF in PdfView", async () => {
        renderPanel(
            document({
                filename: "Letter.pdf",
                file_type: "pdf",
                pdf_storage_path: "documents/u/doc/source.pdf",
            }),
        );
        expect(await screen.findByText("pdf-viewer")).toBeInTheDocument();
    });
});
