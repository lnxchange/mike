import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    getMembershipOrgApiKeys,
    getOrgApiKeyStatus,
    getOrgApiKeys,
    saveOrgApiKey,
} from "../orgApiKeys";

type Row = Record<string, unknown>;

function createKeyDb(initial: Record<string, Row[]> = {}) {
    const tables: Record<string, Row[]> = {
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

    return { from: (table: string) => query(table) };
}

describe("org API keys", () => {
    beforeEach(() => {
        process.env.USER_API_KEYS_ENCRYPTION_SECRET = "test-secret";
    });

    afterEach(() => {
        delete process.env.USER_API_KEYS_ENCRYPTION_SECRET;
    });

    it("encrypts, reads, and removes an organisation key", async () => {
        const db = createKeyDb();
        await saveOrgApiKey("org-1", "claude", "sk-ant-org", db as never);

        await expect(getOrgApiKeys("org-1", db as never)).resolves.toMatchObject({
            claude: "sk-ant-org",
        });
        await expect(
            getOrgApiKeyStatus("org-1", db as never),
        ).resolves.toMatchObject({
            claude: true,
            openai: false,
        });

        await saveOrgApiKey("org-1", "claude", null, db as never);
        await expect(getOrgApiKeys("org-1", db as never)).resolves.toEqual({});
        await expect(
            getOrgApiKeyStatus("org-1", db as never),
        ).resolves.toMatchObject({
            claude: false,
        });
    });

    it("returns membership keys for invited staff", async () => {
        const db = createKeyDb({
            org_members: [{ org_id: "org-1", user_id: "member-1" }],
        });
        await saveOrgApiKey("org-1", "claude", "sk-ant-org", db as never);

        await expect(
            getMembershipOrgApiKeys("member-1", db as never),
        ).resolves.toMatchObject({
            keys: { claude: "sk-ant-org" },
            sources: { claude: "org" },
        });
        await expect(
            getMembershipOrgApiKeys("outsider", db as never),
        ).resolves.toEqual({
            keys: {},
            sources: {},
        });
    });
});
