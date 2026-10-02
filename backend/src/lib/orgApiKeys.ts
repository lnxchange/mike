import crypto from "crypto";
import { createServerSupabase, type Db } from "./supabase";
import { logError } from "./log";
import type { UserApiKeys } from "./llm";

export type OrgApiKeyProvider =
    | "claude"
    | "gemini"
    | "openai"
    | "openrouter"
    | "vercel"
    | "opencode-go"
    | "courtlistener";

const PROVIDERS: OrgApiKeyProvider[] = [
    "claude",
    "gemini",
    "openai",
    "openrouter",
    "vercel",
    "opencode-go",
    "courtlistener",
];

export type OrgApiKeyStatus = Record<OrgApiKeyProvider, boolean>;

type EncryptedKeyRow = {
    org_id?: string;
    provider: OrgApiKeyProvider;
    encrypted_key: string;
    iv: string;
    auth_tag: string;
};

const KEY_SALT = "mike-org-api-keys-v1";
const derivedKeys = new Map<string, Buffer>();

function encryptionKey(): Buffer {
    const secret = process.env.USER_API_KEYS_ENCRYPTION_SECRET;
    if (!secret) {
        throw new Error("USER_API_KEYS_ENCRYPTION_SECRET is not configured");
    }
    const cacheKey = `${KEY_SALT}:${secret}`;
    const cached = derivedKeys.get(cacheKey);
    if (cached) return cached;
    const derived = crypto.scryptSync(secret, KEY_SALT, 32);
    derivedKeys.set(cacheKey, derived);
    return derived;
}

function encrypt(value: string): Omit<EncryptedKeyRow, "provider" | "org_id"> {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
    ]);
    return {
        encrypted_key: encrypted.toString("base64"),
        iv: iv.toString("base64"),
        auth_tag: cipher.getAuthTag().toString("base64"),
    };
}

function decrypt(row: EncryptedKeyRow): string | null {
    try {
        const decipher = crypto.createDecipheriv(
            "aes-256-gcm",
            encryptionKey(),
            Buffer.from(row.iv, "base64"),
        );
        decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(row.encrypted_key, "base64")),
            decipher.final(),
        ]);
        return decrypted.toString("utf8");
    } catch (err) {
        logError("org-api-keys", err, {
            detail: "failed to decrypt stored key",
            provider: row.provider,
        });
        return null;
    }
}

function isProvider(value: string): value is OrgApiKeyProvider {
    return (PROVIDERS as string[]).includes(value);
}

export function normalizeOrgApiKeyProvider(
    value: string,
): OrgApiKeyProvider | null {
    return isProvider(value) ? value : null;
}

function emptyStatus(): OrgApiKeyStatus {
    return {
        claude: false,
        gemini: false,
        openai: false,
        openrouter: false,
        vercel: false,
        "opencode-go": false,
        courtlistener: false,
    };
}

export async function getOrgApiKeyStatus(
    orgId: string,
    db: Db = createServerSupabase(),
): Promise<OrgApiKeyStatus> {
    const status = emptyStatus();
    const { data, error } = await db
        .from("org_api_keys")
        .select("provider")
        .eq("org_id", orgId);
    if (error) throw error;

    for (const row of data ?? []) {
        const provider = normalizeOrgApiKeyProvider(String(row.provider));
        if (provider) status[provider] = true;
    }
    return status;
}

export async function getOrgApiKeys(
    orgId: string,
    db: Db = createServerSupabase(),
): Promise<UserApiKeys> {
    const apiKeys: UserApiKeys = {};
    const { data, error } = await db
        .from("org_api_keys")
        .select("provider, encrypted_key, iv, auth_tag")
        .eq("org_id", orgId);
    if (error) throw error;

    for (const row of (data ?? []) as EncryptedKeyRow[]) {
        const provider = normalizeOrgApiKeyProvider(row.provider);
        if (!provider) continue;
        const orgKey = decrypt(row)?.trim() || null;
        if (orgKey) apiKeys[provider] = orgKey;
    }
    return apiKeys;
}

export async function saveOrgApiKey(
    orgId: string,
    provider: OrgApiKeyProvider,
    value: string | null,
    db: Db = createServerSupabase(),
): Promise<void> {
    const normalized = value?.trim() || null;
    if (!normalized) {
        const { error } = await db
            .from("org_api_keys")
            .delete()
            .eq("org_id", orgId)
            .eq("provider", provider);
        if (error) throw error;
        return;
    }

    const { error } = await db.from("org_api_keys").upsert(
        {
            org_id: orgId,
            provider,
            ...encrypt(normalized),
            updated_at: new Date().toISOString(),
        },
        { onConflict: "org_id,provider" },
    );
    if (error) throw error;
}

export type MembershipOrgApiKeys = {
    keys: UserApiKeys;
    sources: Partial<Record<OrgApiKeyProvider, "org">>;
};

function sortOrgIds(
    orgIds: string[],
    preferredOrgId?: string | null,
): string[] {
    return [...orgIds].sort((a, b) => {
        if (preferredOrgId) {
            if (a === preferredOrgId) return -1;
            if (b === preferredOrgId) return 1;
        }
        return a.localeCompare(b);
    });
}

async function loadMembershipOrgIds(
    userId: string,
    db: Db,
): Promise<string[] | null> {
    const { data, error } = await db
        .from("org_members")
        .select("org_id")
        .eq("user_id", userId);
    if (error) {
        logError("org-api-keys", error, {
            detail: "failed to load organization memberships for API keys",
        });
        return null;
    }
    const orgIds = [
        ...new Set(
            (data ?? [])
                .map((row) =>
                    typeof row.org_id === "string" ? row.org_id : null,
                )
                .filter((id): id is string => !!id),
        ),
    ];
    return orgIds;
}

export async function getMembershipOrgApiKeys(
    userId: string,
    db: Db = createServerSupabase(),
    preferredOrgId?: string | null,
): Promise<MembershipOrgApiKeys> {
    const empty: MembershipOrgApiKeys = { keys: {}, sources: {} };
    const orgIds = await loadMembershipOrgIds(userId, db);
    if (!orgIds || orgIds.length === 0) return empty;

    const { data, error } = await db
        .from("org_api_keys")
        .select("org_id, provider, encrypted_key, iv, auth_tag")
        .in("org_id", orgIds);
    if (error) {
        logError("org-api-keys", error, {
            detail: "failed to load organization API keys",
        });
        return empty;
    }

    const sortedOrgIds = sortOrgIds(orgIds, preferredOrgId);
    const keys: UserApiKeys = {};
    const sources: Partial<Record<OrgApiKeyProvider, "org">> = {};
    for (const orgId of sortedOrgIds) {
        for (const row of (data ?? []) as EncryptedKeyRow[]) {
            if (row.org_id !== orgId) continue;
            const provider = normalizeOrgApiKeyProvider(row.provider);
            if (!provider || keys[provider]) continue;
            const orgKey = decrypt(row)?.trim() || null;
            if (!orgKey) continue;
            keys[provider] = orgKey;
            sources[provider] = "org";
        }
    }
    return { keys, sources };
}

export async function getMembershipOrgApiKeySources(
    userId: string,
    db: Db = createServerSupabase(),
    preferredOrgId?: string | null,
): Promise<Partial<Record<OrgApiKeyProvider, "org">>> {
    const orgIds = await loadMembershipOrgIds(userId, db);
    if (!orgIds || orgIds.length === 0) return {};

    const { data, error } = await db
        .from("org_api_keys")
        .select("org_id, provider")
        .in("org_id", orgIds);
    if (error) {
        logError("org-api-keys", error, {
            detail: "failed to load organization API key status",
        });
        return {};
    }

    const sortedOrgIds = sortOrgIds(orgIds, preferredOrgId);
    const sources: Partial<Record<OrgApiKeyProvider, "org">> = {};
    for (const orgId of sortedOrgIds) {
        for (const row of data ?? []) {
            if (row.org_id !== orgId) continue;
            const provider = normalizeOrgApiKeyProvider(String(row.provider));
            if (!provider || sources[provider]) continue;
            sources[provider] = "org";
        }
    }
    return sources;
}
