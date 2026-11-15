import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveUserApiKey } from "../../user/user.service";
import { getOrgApiKeysStatus, saveOrgApiKeyForAdmin } from "../orgs.apiKeys";

type Row = Record<string, unknown>;

function createDb(initial: Record<string, Row[]> = {}) {
    const tables: Record<string, Row[]> = {
        org_members: [],
        org_api_keys: [],
        user_api_keys: [],
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

    return { from: (table: string) => query(table) };
}

describe("orgs.apiKeys authorization", () => {
    beforeEach(() => {
        process.env.USER_API_KEYS_ENCRYPTION_SECRET = "test-secret";
    });

    afterEach(() => {
        delete process.env.USER_API_KEYS_ENCRYPTION_SECRET;
    });

    it("lets a member read status but not write", async () => {
        const db = createDb({
            org_members: [
                { org_id: "org-1", user_id: "admin-1", role: "admin" },
                { org_id: "org-1", user_id: "member-1", role: "member" },
            ],
        });

        await expect(
            getOrgApiKeysStatus(db as never, {
                userId: "member-1",
                orgId: "org-1",
            }),
        ).resolves.toMatchObject({ ok: true, status: { claude: false } });

        await expect(
            saveOrgApiKeyForAdmin(db as never, {
                userId: "member-1",
                orgId: "org-1",
                provider: "claude",
                apiKey: "sk-ant",
            }),
        ).resolves.toMatchObject({ ok: false, kind: "forbidden" });
    });

    it("rejects use_personal when the admin has no saved personal key", async () => {
        const db = createDb({
            org_members: [
                { org_id: "org-1", user_id: "admin-1", role: "admin" },
            ],
        });

        await expect(
            saveOrgApiKeyForAdmin(db as never, {
                userId: "admin-1",
                orgId: "org-1",
                provider: "claude",
                apiKey: null,
                usePersonal: true,
            }),
        ).resolves.toMatchObject({
            ok: false,
            kind: "validation",
            detail: "No personal API key is saved for this provider.",
        });
    });

    it("copies a personal key onto the organisation", async () => {
        const db = createDb({
            org_members: [
                { org_id: "org-1", user_id: "admin-1", role: "admin" },
            ],
        });
        await saveUserApiKey("admin-1", "claude", "sk-ant-personal", db as never);

        await expect(
            saveOrgApiKeyForAdmin(db as never, {
                userId: "admin-1",
                orgId: "org-1",
                provider: "claude",
                apiKey: null,
                usePersonal: true,
            }),
        ).resolves.toMatchObject({
            ok: true,
            status: { claude: true },
        });
    });
});
