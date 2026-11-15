import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssistantMessage } from "./AssistantMessage";
import type { AssistantEvent } from "../shared/types";

describe("AssistantMessage doc_finalized", () => {
    it("shows the clean copy with what was accepted and opens it", () => {
        const onOpenDocument = vi.fn();
        const events: AssistantEvent[] = [
            {
                type: "doc_finalized",
                filename: "MSA (clean).docx",
                source_filename: "MSA AL Markup.docx",
                document_id: "document-clean",
                version_id: "version-clean",
                version_number: 1,
                source_document_id: "document-src",
                download_url: "",
                accepted: 9,
                comments_removed: 3,
            },
        ];

        render(
            <AssistantMessage events={events} onOpenDocument={onOpenDocument} />,
        );

        expect(screen.getByText("Clean copy")).toBeInTheDocument();
        expect(
            screen.getByText("9 changes accepted from MSA AL Markup.docx"),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "MSA (clean).docx" }));
        expect(onOpenDocument).toHaveBeenCalledWith({
            documentId: "document-clean",
            filename: "MSA (clean).docx",
            versionId: "version-clean",
            versionNumber: 1,
        });
    });

    it("renders the in-progress and failed states", () => {
        const { rerender } = render(
            <AssistantMessage
                events={[
                    {
                        type: "doc_finalized",
                        filename: "MSA AL Markup.docx",
                        source_filename: "MSA AL Markup.docx",
                        isStreaming: true,
                    },
                ]}
            />,
        );
        expect(screen.getByText("Finalising")).toBeInTheDocument();

        rerender(
            <AssistantMessage
                events={[
                    {
                        type: "doc_finalized",
                        filename: "MSA AL Markup.docx",
                        source_filename: "MSA AL Markup.docx",
                        error: "finalize_document only supports .docx files.",
                    },
                ]}
            />,
        );
        expect(screen.getByText("Finalise failed")).toBeInTheDocument();
    });
});
