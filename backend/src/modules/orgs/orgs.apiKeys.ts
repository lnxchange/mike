import { getOrgRole, isOrgAdmin } from "../../lib/access";
import {
    getOrgApiKeyStatus,
    normalizeOrgApiKeyProvider,
    saveOrgApiKey,
    type OrgApiKeyProvider,
    type OrgApiKeyStatus,
} from "../../lib/orgApiKeys";
import type { OrgResult } from "../../lib/orgs";
import type { Db } from "../../lib/supabase";
import { getStoredUserApiKey } from "../user/user.service";

export type { OrgApiKeyProvider, OrgApiKeyStatus };
export { normalizeOrgApiKeyProvider };

export async function getOrgApiKeysStatus(
    db: Db,
    params: { userId: string; orgId: string },
): Promise<OrgResult<{ status: OrgApiKeyStatus }>> {
    const role = await getOrgRole(params.userId, params.orgId, db);
    if (!role) return { ok: false, kind: "not_found" };
    try {
        const status = await getOrgApiKeyStatus(params.orgId, db);
        return { ok: true, status };
    } catch (error) {
        return {
            ok: false,
            kind: "db_error",
            detail: error instanceof Error ? error.message : "Failed to load API keys",
        };
    }
}

export async function saveOrgApiKeyForAdmin(
    db: Db,
    params: {
        userId: string;
        orgId: string;
        provider: OrgApiKeyProvider;
        apiKey: string | null;
        usePersonal?: boolean;
    },
): Promise<OrgResult<{ status: OrgApiKeyStatus }>> {
    const role = await getOrgRole(params.userId, params.orgId, db);
    if (!role) return { ok: false, kind: "not_found" };
    if (!isOrgAdmin(role)) return { ok: false, kind: "forbidden" };

    let value = params.apiKey;
    if (params.usePersonal) {
        try {
            const personal = await getStoredUserApiKey(
                params.userId,
                params.provider,
                db,
            );
            if (!personal) {
                return {
                    ok: false,
                    kind: "validation",
                    detail: "No personal API key is saved for this provider.",
                };
            }
            value = personal;
        } catch (error) {
            return {
                ok: false,
                kind: "db_error",
                detail:
                    error instanceof Error
                        ? error.message
                        : "Failed to read the personal API key",
            };
        }
    }

    try {
        await saveOrgApiKey(params.orgId, params.provider, value, db);
        const status = await getOrgApiKeyStatus(params.orgId, db);
        return { ok: true, status };
    } catch (error) {
        return {
            ok: false,
            kind: "db_error",
            detail:
                error instanceof Error
                    ? error.message
                    : "Failed to save the organization API key",
        };
    }
}
