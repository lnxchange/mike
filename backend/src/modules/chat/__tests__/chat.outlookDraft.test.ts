import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOutlookDraft } from "../../integrations/integrations.service";
import { getDocument } from "../../documents/documents.service";
import { loadCurrentVersionBytes } from "../engine/tools/documentOps";
import { stageOutlookPreview } from "../chat.outlookDraft";

vi.mock("../../integrations/integrations.service", () => ({
    createOutlookDraft: vi.fn(),
}));
vi.mock("../../documents/documents.service", () => ({
    getDocument: vi.fn(),
}));
vi.mock("../engine/tools/documentOps", () => ({
    loadCurrentVersionBytes: vi.fn(),
}));

const preview = {
    type: "outlook_draft_preview",
    subject: "Schedule",
    to: ["alissa@example.com"],
    html_body: "<p>Please find the schedule.</p><p>Kind regards,</p>",
    attachment_names: ["note.pdf"],
    attachment_document_ids: ["doc-1"],
};

function dbWith(content: unknown[]) {
    const updates: unknown[] = [];
    const db = {
        updates,
        from() {
            return {
                select() {
                    return {
                        eq() {
                            return {
                                eq() {
                                    return {
                                        maybeSingle: async () => ({
                                            data: {
                                                role: "assistant",
                                                content,
                                            },
                                            error: null,
                                        }),
                                    };
                                },
                            };
                        },
                    };
                },
                update(payload: unknown) {
                    updates.push(payload);
                    return {
                        eq() {
                            return {
                                eq: async () => ({ error: null }),
                            };
                        },
                    };
                },
            };
        },
    };
    return db;
}

describe("stageOutlookPreview", () => {
    beforeEach(() => {
        vi.mocked(createOutlookDraft).mockReset();
        vi.mocked(getDocument).mockReset();
        vi.mocked(loadCurrentVersionBytes).mockReset();
    });

    it("stages the stored draft without asking for a new body", async () => {
        vi.mocked(getDocument).mockResolvedValue({
            ok: true,
            doc: { filename: "note.pdf" },
        });
        vi.mocked(loadCurrentVersionBytes).mockResolvedValue({
            bytes: Buffer.from("pdf"),
            storage_path: "files/note.pdf",
        });
        vi.mocked(createOutlookDraft).mockResolvedValue({
            kind: "outlook_draft_created",
            webLink: "https://outlook.office.com/mail/draft-1",
            subject: "Schedule",
            to: ["alissa@example.com"],
            attachmentNames: ["note.pdf"],
            threaded: false,
            threadStatus: "new",
        });
        const db = dbWith([
            { type: "content", text: "Here is the draft." },
            preview,
        ]);

        const result = await stageOutlookPreview(db as never, {
            chatId: "chat-1",
            messageId: "message-1",
            userId: "user-1",
            userEmail: "yule@attune.legal",
            eventIndex: 1,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.event.web_link).toBe(
            "https://outlook.office.com/mail/draft-1",
        );
        expect(result.event.html_body).toContain("Please find the schedule.");
        expect(createOutlookDraft).toHaveBeenCalledWith(
            db,
            "user-1",
            expect.objectContaining({
                subject: "Schedule",
                htmlBody: preview.html_body,
                to: ["alissa@example.com"],
            }),
        );
        const saved = db.updates[0] as { content: { type: string }[] };
        expect(saved.content[0]).toEqual({
            type: "content",
            text: "Here is the draft.",
        });
        expect(saved.content[1]).toMatchObject({
            type: "outlook_draft_created",
            web_link: "https://outlook.office.com/mail/draft-1",
        });
    });

    it("leaves the card unchanged when Microsoft is not connected", async () => {
        vi.mocked(createOutlookDraft).mockResolvedValue({
            kind: "outlook_auth_required",
        });
        const db = dbWith([{ ...preview, attachment_names: [], attachment_document_ids: [] }]);

        const result = await stageOutlookPreview(db as never, {
            chatId: "chat-1",
            messageId: "message-1",
            userId: "user-1",
            userEmail: "yule@attune.legal",
            eventIndex: 0,
        });

        expect(result).toEqual({ ok: false, kind: "outlook_auth_required" });
        expect(db.updates).toHaveLength(0);
        expect(getDocument).not.toHaveBeenCalled();
    });
});
