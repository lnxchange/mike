import { beforeEach, describe, expect, it, vi } from "vitest";

const graph = vi.hoisted(() => ({
  addFileAttachment: vi.fn(),
  createDraftMessage: vi.fn(),
  createReplyDraft: vi.fn(),
  findMessageByInternetMessageId: vi.fn(),
  patchDraftMessage: vi.fn(),
  searchMailboxMessages: vi.fn(),
  getGraphAccessToken: vi.fn(),
}));

vi.mock("../integrations.graph", () => ({
  GraphAuthError: class GraphAuthError extends Error {
    invalidGrant = true;
  },
  addFileAttachment: graph.addFileAttachment,
  createDraftMessage: graph.createDraftMessage,
  createReplyDraft: graph.createReplyDraft,
  findMessageByInternetMessageId: graph.findMessageByInternetMessageId,
  patchDraftMessage: graph.patchDraftMessage,
  searchMailboxMessages: graph.searchMailboxMessages,
}));

vi.mock("../integrations.microsoftAuth", () => ({
  getGraphAccessToken: graph.getGraphAccessToken,
}));

import { createOutlookDraft } from "../integrations.outlookDraft";

const input = {
  to: ["alissa@example.com"],
  subject: "Re: Schedule",
  htmlBody: "<p>Kind regards,</p>",
};

describe("createOutlookDraft", () => {
  beforeEach(() => {
    for (const fn of Object.values(graph)) fn.mockReset();
    graph.getGraphAccessToken.mockResolvedValue({
      kind: "ok",
      accessToken: "token",
    });
    graph.createDraftMessage.mockResolvedValue({
      id: "draft-1",
      webLink: "https://outlook.office.com/mail/draft-1",
    });
    graph.addFileAttachment.mockResolvedValue(undefined);
  });

  it("returns connect when no Graph grant exists", async () => {
    graph.getGraphAccessToken.mockResolvedValue({
      kind: "outlook_auth_required",
    });
    await expect(
      createOutlookDraft({} as never, "user-1", input),
    ).resolves.toEqual({ kind: "outlook_auth_required" });
  });

  it("creates a new draft when mailbox search is empty", async () => {
    graph.findMessageByInternetMessageId.mockResolvedValue(null);
    graph.searchMailboxMessages.mockResolvedValue([]);
    const result = await createOutlookDraft({} as never, "user-1", input);
    expect(result).toMatchObject({
      kind: "outlook_draft_created",
      threaded: false,
      webLink: "https://outlook.office.com/mail/draft-1",
    });
    expect(graph.createReplyDraft).not.toHaveBeenCalled();
  });

  it("replies when a Message-ID resolves to one message", async () => {
    graph.findMessageByInternetMessageId.mockResolvedValue({
      id: "msg-1",
      conversationId: "conv-1",
    });
    graph.createReplyDraft.mockResolvedValue({ id: "reply-draft" });
    graph.patchDraftMessage.mockResolvedValue({
      id: "reply-draft",
      webLink: "https://outlook.office.com/mail/reply-draft",
    });
    const result = await createOutlookDraft({} as never, "user-1", {
      ...input,
      inReplyToInternetMessageId: "<chain-123@example.com>",
    });
    expect(result).toMatchObject({
      kind: "outlook_draft_created",
      threaded: true,
    });
    expect(graph.createReplyDraft).toHaveBeenCalledWith("token", "msg-1");
  });

  it("creates a new draft when two conversations match", async () => {
    graph.findMessageByInternetMessageId.mockResolvedValue(null);
    graph.searchMailboxMessages.mockResolvedValue([
      { id: "a", conversationId: "c1", receivedDateTime: "2026-09-20T00:00:00Z" },
      { id: "b", conversationId: "c2", receivedDateTime: "2026-09-21T00:00:00Z" },
    ]);
    const result = await createOutlookDraft({} as never, "user-1", input);
    expect(result).toMatchObject({
      kind: "outlook_draft_created",
      threaded: false,
    });
    expect(graph.createReplyDraft).not.toHaveBeenCalled();
  });

  it("rejects oversized attachments", async () => {
    const result = await createOutlookDraft({} as never, "user-1", {
      ...input,
      attachments: [
        {
          filename: "huge.bin",
          contentType: "application/octet-stream",
          bytes: Buffer.alloc(141 * 1024 * 1024),
        },
      ],
    });
    expect(result.kind).toBe("error");
    expect(graph.createDraftMessage).not.toHaveBeenCalled();
  });
});
