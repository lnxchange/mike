import { beforeEach, describe, expect, it, vi } from "vitest";

const { refreshMicrosoftTokens } = vi.hoisted(() => ({
  refreshMicrosoftTokens: vi.fn(),
}));

vi.mock("../integrations.graph", () => ({
  GraphAuthError: class GraphAuthError extends Error {
    invalidGrant: boolean;
    constructor(message: string, invalidGrant = false) {
      super(message);
      this.invalidGrant = invalidGrant;
    }
  },
  getMailboxUpn: vi.fn(async () => "lawyer@example.test"),
  refreshMicrosoftTokens,
}));

import { encryptSecret } from "../integrations.crypto";
import {
  getGraphAccessToken,
  persistMicrosoftTokens,
} from "../integrations.microsoftAuth";

function fakeDb(row: Record<string, unknown> | null = null) {
  const deleted: string[] = [];
  const upserts: unknown[] = [];
  return {
    deleted,
    upserts,
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: table === "user_microsoft_tokens" ? row : null,
                  error: null,
                }),
              };
            },
          };
        },
        upsert(value: unknown) {
          upserts.push(value);
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            eq(_column: string, userId: string) {
              deleted.push(userId);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

describe("microsoft token vault", () => {
  beforeEach(() => {
    process.env.USER_API_KEYS_ENCRYPTION_SECRET = "test-microsoft-secret";
    process.env.MICROSOFT_OAUTH_CLIENT_ID = "client";
    process.env.MICROSOFT_OAUTH_CLIENT_SECRET = "secret";
    refreshMicrosoftTokens.mockReset();
  });

  it("returns a live access token without refreshing", async () => {
    const access = encryptSecret("live-access");
    const refresh = encryptSecret("live-refresh");
    const db = fakeDb({
      user_id: "user-1",
      encrypted_access_token: access.encrypted,
      access_token_iv: access.iv,
      access_token_tag: access.tag,
      encrypted_refresh_token: refresh.encrypted,
      refresh_token_iv: refresh.iv,
      refresh_token_tag: refresh.tag,
      access_token_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      granted_scopes: "Mail.ReadWrite",
      mailbox_upn: "lawyer@example.test",
    });
    const result = await getGraphAccessToken(db as never, "user-1");
    expect(result).toEqual({ kind: "ok", accessToken: "live-access" });
    expect(refreshMicrosoftTokens).not.toHaveBeenCalled();
  });

  it("clears the row on invalid_grant", async () => {
    const access = encryptSecret("stale-access");
    const refresh = encryptSecret("stale-refresh");
    const db = fakeDb({
      user_id: "user-1",
      encrypted_access_token: access.encrypted,
      access_token_iv: access.iv,
      access_token_tag: access.tag,
      encrypted_refresh_token: refresh.encrypted,
      refresh_token_iv: refresh.iv,
      refresh_token_tag: refresh.tag,
      access_token_expires_at: new Date(Date.now() - 1000).toISOString(),
      granted_scopes: "Mail.ReadWrite",
      mailbox_upn: "lawyer@example.test",
    });
    const { GraphAuthError } = await import("../integrations.graph");
    refreshMicrosoftTokens.mockRejectedValue(
      new GraphAuthError("expired", true),
    );
    const result = await getGraphAccessToken(db as never, "user-1");
    expect(result).toEqual({ kind: "outlook_auth_required" });
    expect(db.deleted).toEqual(["user-1"]);
  });

  it("upserts encrypted tokens", async () => {
    const db = fakeDb(null);
    await persistMicrosoftTokens(db as never, "user-1", {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: new Date("2026-09-21T00:00:00.000Z"),
      grantedScopes: "Mail.ReadWrite",
      mailboxUpn: "lawyer@example.test",
    });
    expect(db.upserts).toHaveLength(1);
    const row = db.upserts[0] as { encrypted_access_token: string };
    expect(row.encrypted_access_token).not.toBe("a");
  });
});
