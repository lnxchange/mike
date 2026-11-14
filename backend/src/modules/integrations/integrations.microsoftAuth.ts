import type { User } from "@supabase/supabase-js";
import type { Db } from "../../lib/supabase";
import {
  MICROSOFT_GRAPH_SCOPES,
  microsoftOAuthClientCredentials,
} from "../../lib/microsoftOAuth";
import { decryptSecret, encryptSecret } from "./integrations.crypto";
import { GraphAuthError, getMailboxUpn, refreshMicrosoftTokens } from "./integrations.graph";
import type {
  MicrosoftTokenRow,
  PersistMicrosoftTokensInput,
} from "./integrations.shared";

function hasAzureIdentity(user: Pick<User, "identities"> | null | undefined) {
  return (user?.identities ?? []).some(
    (identity) => identity.provider === "azure",
  );
}

export function azureIdentity(
  user: Pick<User, "identities"> | null | undefined,
) {
  return (user?.identities ?? []).find(
    (identity) => identity.provider === "azure",
  );
}

export async function persistMicrosoftTokens(
  db: Db,
  userId: string,
  tokens: PersistMicrosoftTokensInput,
) {
  const access = encryptSecret(tokens.accessToken);
  const refresh = encryptSecret(tokens.refreshToken);
  const row = {
    user_id: userId,
    encrypted_access_token: access.encrypted,
    access_token_iv: access.iv,
    access_token_tag: access.tag,
    encrypted_refresh_token: refresh.encrypted,
    refresh_token_iv: refresh.iv,
    refresh_token_tag: refresh.tag,
    access_token_expires_at: tokens.expiresAt.toISOString(),
    granted_scopes: tokens.grantedScopes,
    mailbox_upn: tokens.mailboxUpn ?? null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("user_microsoft_tokens").upsert(row, {
    onConflict: "user_id",
  });
  if (error) throw error;
}

export async function deleteMicrosoftTokens(db: Db, userId: string) {
  const { error } = await db
    .from("user_microsoft_tokens")
    .delete()
    .eq("user_id", userId);
  if (error) throw error;
}

export async function hasLiveMicrosoftGrant(
  db: Db,
  userId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("user_microsoft_tokens")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

export async function isMicrosoftConnected(
  db: Db,
  user: Pick<User, "id" | "identities">,
): Promise<boolean> {
  if (!hasAzureIdentity(user)) return false;
  return hasLiveMicrosoftGrant(db, user.id);
}

async function loadTokenRow(
  db: Db,
  userId: string,
): Promise<MicrosoftTokenRow | null> {
  const { data, error } = await db
    .from("user_microsoft_tokens")
    .select(
      "user_id, encrypted_access_token, access_token_iv, access_token_tag, encrypted_refresh_token, refresh_token_iv, refresh_token_tag, access_token_expires_at, granted_scopes, mailbox_upn",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as MicrosoftTokenRow;
}

export type GraphTokenResult =
  | { kind: "ok"; accessToken: string }
  | { kind: "outlook_auth_required" };

export async function getGraphAccessToken(
  db: Db,
  userId: string,
): Promise<GraphTokenResult> {
  const row = await loadTokenRow(db, userId);
  if (!row) return { kind: "outlook_auth_required" };

  const accessToken = decryptSecret(
    row.encrypted_access_token,
    row.access_token_iv,
    row.access_token_tag,
  );
  const refreshToken = decryptSecret(
    row.encrypted_refresh_token,
    row.refresh_token_iv,
    row.refresh_token_tag,
  );
  if (!accessToken || !refreshToken) {
    await deleteMicrosoftTokens(db, userId);
    return { kind: "outlook_auth_required" };
  }

  const expiresAt = new Date(row.access_token_expires_at).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > 60_000) {
    return { kind: "ok", accessToken };
  }

  try {
    const credentials = microsoftOAuthClientCredentials();
    const refreshed = await refreshMicrosoftTokens({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken,
      scopes: MICROSOFT_GRAPH_SCOPES,
    });
    let mailboxUpn = row.mailbox_upn;
    try {
      mailboxUpn = (await getMailboxUpn(refreshed.accessToken)) ?? mailboxUpn;
    } catch {
      // Keep the stored UPN when /me is briefly unavailable.
    }
    await persistMicrosoftTokens(db, userId, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
      grantedScopes: refreshed.grantedScopes,
      mailboxUpn,
    });
    return { kind: "ok", accessToken: refreshed.accessToken };
  } catch (error) {
    if (error instanceof GraphAuthError && error.invalidGrant) {
      await deleteMicrosoftTokens(db, userId);
      return { kind: "outlook_auth_required" };
    }
    throw error;
  }
}

export async function persistProviderSessionTokens(
  db: Db,
  userId: string,
  session: {
    provider_token?: string | null;
    provider_refresh_token?: string | null;
    expires_in?: number | null;
    expires_at?: number | null;
  },
) {
  if (!session.provider_token || !session.provider_refresh_token) return;
  const expiresAt = session.expires_at
    ? new Date(session.expires_at * 1000)
    : new Date(
        Date.now() +
          (typeof session.expires_in === "number" && session.expires_in > 0
            ? session.expires_in
            : 3600) *
            1000,
      );
  let mailboxUpn: string | null = null;
  try {
    mailboxUpn = await getMailboxUpn(session.provider_token);
  } catch {
    mailboxUpn = null;
  }
  await persistMicrosoftTokens(db, userId, {
    accessToken: session.provider_token,
    refreshToken: session.provider_refresh_token,
    expiresAt,
    grantedScopes: MICROSOFT_GRAPH_SCOPES,
    mailboxUpn,
  });
}
