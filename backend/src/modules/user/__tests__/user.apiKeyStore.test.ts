import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { saveOrgApiKey } from "../../../lib/orgApiKeys";
import {
    normalizeApiKeyProvider,
    hasEnvApiKey,
    getUserApiKeys,
    getUserApiKeyStatus,
    saveUserApiKey,
} from "../user.apiKeyStore";

type Row = Record<string, unknown>;

function createKeyDb(initial: Record<string, Row[]> = {}) {
    const tables: Record<string, Row[]> = {
        user_api_keys: [],
        org_members: [],
        org_api_keys: [],
        ...Object.fromEntries(
            Object.entries(initial).map(([name, rows]) => [name, [...rows]]),
        ),
    };

    function query(table: string) {
        const filters: { col: string; val: unknown; mode: "eq" | "in" }[] = [];
        let op: "select" | "upsert" | "delete" = "select";
        let payload: Row | null = null;
        let conflictCols: string[] = [];

        const ensure = () => (tables[table] ??= []);
        const matches = (rows: Row[]) =>
            rows.filter((row) =>
                filters.every((filter) =>
                    filter.mode === "in"
                        ? (filter.val as unknown[]).includes(row[filter.col])
                        : row[filter.col] === filter.val,
                ),
            );

        async function resolveMany() {
            const arr = ensure();
            if (op === "upsert" && payload) {
                const existing = conflictCols.length
                    ? arr.find((row) =>
                          conflictCols.every((col) => row[col] === payload?.[col]),
                      )
                    : undefined;
                if (existing) Object.assign(existing, payload);
                else arr.push({ ...payload });
                return { data: [payload], error: null };
            }
            const matched = matches(arr);
            if (op === "delete") {
                tables[table] = arr.filter((row) => !matched.includes(row));
                return { data: matched, error: null };
            }
            return { data: matched, error: null };
        }

        const builder: Record<string, unknown> = {
            select: () => builder,
            eq: (col: string, val: unknown) => {
                filters.push({ col, val, mode: "eq" });
                return builder;
            },
            in: (col: string, vals: unknown[]) => {
                filters.push({ col, val: vals, mode: "in" });
                return builder;
            },
            upsert: (row: Row, opts?: { onConflict?: string }) => {
                op = "upsert";
                payload = row;
                conflictCols = (opts?.onConflict ?? "")
                    .split(",")
                    .map((col) => col.trim())
                    .filter(Boolean);
                return builder;
            },
            delete: () => {
                op = "delete";
                return builder;
            },
            maybeSingle: async () => {
                const { data, error } = await resolveMany();
                return { data: data?.[0] ?? null, error };
            },
            then: (
                resolve: (value: {
                    data: Row[] | null;
                    error: null;
                }) => unknown,
                reject?: (reason: unknown) => unknown,
            ) => resolveMany().then(resolve, reject),
        };
        return builder;
    }

    return {
        from: (table: string) => query(table),
        tables,
    };
}

describe("normalizeApiKeyProvider", () => {
    it('returns "claude" for "claude"', () => {
        expect(normalizeApiKeyProvider("claude")).toBe("claude");
    });

    it('returns "openai" for "openai"', () => {
        expect(normalizeApiKeyProvider("openai")).toBe("openai");
    });

    it('returns "gemini" for "gemini"', () => {
        expect(normalizeApiKeyProvider("gemini")).toBe("gemini");
    });

    it("returns the supported router providers", () => {
        expect(normalizeApiKeyProvider("openrouter")).toBe("openrouter");
        expect(normalizeApiKeyProvider("vercel")).toBe("vercel");
        expect(normalizeApiKeyProvider("opencode-go")).toBe("opencode-go");
    });

    it("returns null for unknown provider strings", () => {
        expect(normalizeApiKeyProvider("unknown")).toBeNull();
        expect(normalizeApiKeyProvider("")).toBeNull();
        expect(normalizeApiKeyProvider("Claude")).toBeNull();
        expect(normalizeApiKeyProvider("OPENAI")).toBeNull();
    });
});

describe("hasEnvApiKey", () => {
    const envVars = [
        "ANTHROPIC_API_KEY",
        "CLAUDE_API_KEY",
        "OPENAI_API_KEY",
        "GEMINI_API_KEY",
        "OPENROUTER_API_KEY",
        "AI_GATEWAY_API_KEY",
        "VERCEL_AI_GATEWAY_API_KEY",
        "OPENCODE_API_KEY",
        "USER_API_KEYS_ENCRYPTION_SECRET",
    ];

    // Clear before AND after each test so keys exported in the developer's
    // shell (or CI) can't leak into assertions.
    beforeEach(() => {
        for (const v of envVars) delete process.env[v];
    });

    afterEach(() => {
        for (const v of envVars) delete process.env[v];
    });

    it("returns true for claude when ANTHROPIC_API_KEY is set", () => {
        process.env.ANTHROPIC_API_KEY = "sk-ant-test";
        expect(hasEnvApiKey("claude")).toBe(true);
    });

    it("returns true for claude when CLAUDE_API_KEY is set as fallback", () => {
        process.env.CLAUDE_API_KEY = "sk-claude-test";
        expect(hasEnvApiKey("claude")).toBe(true);
    });

    it("returns true for openai when OPENAI_API_KEY is set", () => {
        process.env.OPENAI_API_KEY = "sk-openai-test";
        expect(hasEnvApiKey("openai")).toBe(true);
    });

    it("returns true for gemini when GEMINI_API_KEY is set", () => {
        process.env.GEMINI_API_KEY = "gemini-key-test";
        expect(hasEnvApiKey("gemini")).toBe(true);
    });

    it("returns true for Vercel when AI_GATEWAY_API_KEY is set", () => {
        process.env.AI_GATEWAY_API_KEY = "vercel-key-test";
        expect(hasEnvApiKey("vercel")).toBe(true);
    });

    it("accepts VERCEL_AI_GATEWAY_API_KEY as a compatibility alias", () => {
        process.env.VERCEL_AI_GATEWAY_API_KEY = "vercel-key-test";
        expect(hasEnvApiKey("vercel")).toBe(true);
    });

    it("returns true for OpenCode Go when OPENCODE_API_KEY is set", () => {
        process.env.OPENCODE_API_KEY = "opencode-key-test";
        expect(hasEnvApiKey("opencode-go")).toBe(true);
    });

    it("returns false when no env key is set for the provider", () => {
        expect(hasEnvApiKey("claude")).toBe(false);
        expect(hasEnvApiKey("openai")).toBe(false);
        expect(hasEnvApiKey("gemini")).toBe(false);
    });

    it("ignores whitespace-only env values", () => {
        process.env.ANTHROPIC_API_KEY = "   ";
        expect(hasEnvApiKey("claude")).toBe(false);
    });
});

describe("user API key precedence", () => {
    beforeEach(() => {
        process.env.USER_API_KEYS_ENCRYPTION_SECRET = "test-secret";
        delete process.env.OPENAI_API_KEY;
    });

    afterEach(() => {
        delete process.env.USER_API_KEYS_ENCRYPTION_SECRET;
        delete process.env.OPENAI_API_KEY;
    });

    it("uses a saved user key before an environment key", async () => {
        process.env.OPENAI_API_KEY = "environment-key";
        const db = createKeyDb();

        await saveUserApiKey("user-1", "openai", "personal-key", db as never);

        await expect(getUserApiKeys("user-1", db as never)).resolves.toMatchObject({
            openai: "personal-key",
        });
        await expect(
            getUserApiKeyStatus("user-1", db as never),
        ).resolves.toMatchObject({
            openai: true,
            sources: { openai: "user" },
        });
    });

    it("uses an organisation key before an environment key", async () => {
        process.env.OPENAI_API_KEY = "environment-key";
        const db = createKeyDb({
            org_members: [{ org_id: "org-1", user_id: "member-1" }],
        });
        await saveOrgApiKey("org-1", "openai", "org-key", db as never);

        await expect(
            getUserApiKeys("member-1", db as never),
        ).resolves.toMatchObject({
            openai: "org-key",
        });
        await expect(
            getUserApiKeyStatus("member-1", db as never),
        ).resolves.toMatchObject({
            openai: true,
            sources: { openai: "org" },
        });
    });

    it("uses a personal key before an organisation key", async () => {
        const db = createKeyDb({
            org_members: [{ org_id: "org-1", user_id: "member-1" }],
        });
        await saveOrgApiKey("org-1", "openai", "org-key", db as never);
        await saveUserApiKey("member-1", "openai", "personal-key", db as never);

        await expect(
            getUserApiKeys("member-1", db as never),
        ).resolves.toMatchObject({
            openai: "personal-key",
        });
        await expect(
            getUserApiKeyStatus("member-1", db as never),
        ).resolves.toMatchObject({
            openai: true,
            sources: { openai: "user" },
        });
    });

    it("prefers the content organisation when the user belongs to several", async () => {
        const db = createKeyDb({
            org_members: [
                { org_id: "org-a", user_id: "member-1" },
                { org_id: "org-b", user_id: "member-1" },
            ],
        });
        await saveOrgApiKey("org-a", "openai", "org-a-key", db as never);
        await saveOrgApiKey("org-b", "openai", "org-b-key", db as never);

        await expect(
            getUserApiKeys("member-1", db as never, { orgId: "org-b" }),
        ).resolves.toMatchObject({
            openai: "org-b-key",
        });
    });
});
