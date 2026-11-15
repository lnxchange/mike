import { beforeEach, describe, expect, it, vi } from "vitest";

const graph = vi.hoisted(() => ({
  listRecentSentMessageBodies: vi.fn(),
  listInlineFileAttachments: vi.fn(),
  getGraphAccessToken: vi.fn(),
}));

vi.mock("../../../lib/log", () => ({
  logError: vi.fn(),
}));

vi.mock("../integrations.graph", () => ({
  GraphAuthError: class GraphAuthError extends Error {
    invalidGrant = false;
  },
  listRecentSentMessageBodies: graph.listRecentSentMessageBodies,
  listInlineFileAttachments: graph.listInlineFileAttachments,
}));

vi.mock("../integrations.microsoftAuth", () => ({
  getGraphAccessToken: graph.getGraphAccessToken,
}));

import {
  refreshOutlookSignature,
  updateOutlookSignature,
} from "../integrations.outlookSignature";

const saved = { html: null as string | null };

function signatureDb() {
  return {
    from(table: string) {
      if (table !== "user_outlook_signatures") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: saved.html ? { html: saved.html } : null,
                  error: null,
                }),
              };
            },
          };
        },
        upsert: async (row: { html: string }) => {
          saved.html = row.html;
          return { error: null };
        },
        delete() {
          return {
            eq: async () => {
              saved.html = null;
              return { error: null };
            },
          };
        },
      };
    },
  };
}

describe("outlook signature account copy", () => {
  const db = signatureDb() as never;

  beforeEach(() => {
    saved.html = null;
    graph.listRecentSentMessageBodies.mockReset();
    graph.listInlineFileAttachments.mockReset();
    graph.getGraphAccessToken.mockReset();
    graph.getGraphAccessToken.mockResolvedValue({
      kind: "ok",
      accessToken: "token",
    });
  });

  it("saves an edited signature and drops scripts", async () => {
    const result = await updateOutlookSignature(
      db,
      "user-1",
      '<div id="Signature">Yule<script>alert(1)</script></div>',
    );
    expect(result).toEqual({
      ok: true,
      data: { html: '<div id="Signature">Yule</div>' },
    });
    expect(saved.html).toBe('<div id="Signature">Yule</div>');
  });

  it("clears the saved signature when the field is emptied", async () => {
    saved.html = "<div>Yule</div>";
    const result = await updateOutlookSignature(db, "user-1", "   ");
    expect(result).toEqual({ ok: true, data: { html: null } });
    expect(saved.html).toBeNull();
  });

  it("copies sent mail once into the account field", async () => {
    graph.listRecentSentMessageBodies.mockResolvedValue([
      {
        id: "sent-1",
        html: '<div id="Signature"><img src="cid:attune-logo"><b>Yule Guttenbeil</b></div>',
      },
    ]);
    graph.listInlineFileAttachments.mockResolvedValue([
      {
        filename: "attune-logo.png",
        contentType: "image/png",
        bytes: Buffer.from("png"),
        isInline: true,
        contentId: "attune-logo",
      },
    ]);
    const result = await refreshOutlookSignature(db, "user-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.html).toContain("data:image/png;base64,cG5n");
    expect(result.data.html).toContain("Yule Guttenbeil");
    expect(saved.html).toBe(result.data.html);
  });
});
