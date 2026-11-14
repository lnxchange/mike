export const MICROSOFT_GRAPH_SCOPES =
  "openid profile email offline_access User.Read Mail.ReadWrite";

export function microsoftOAuthEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.MICROSOFT_OAUTH_ENABLED?.trim().toLowerCase() === "true";
}

export function microsoftOAuthClientCredentials(
  env: NodeJS.ProcessEnv = process.env,
): { clientId: string; clientSecret: string } {
  const clientId = env.MICROSOFT_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) {
    throw new Error(
      "MICROSOFT_OAUTH_CLIENT_ID and MICROSOFT_OAUTH_CLIENT_SECRET must be set when refreshing Microsoft tokens",
    );
  }
  return { clientId, clientSecret };
}
