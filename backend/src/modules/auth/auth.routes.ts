// HTTP layer for the auth module.
//
// Everything that genuinely needs req/res lives here: creating the
// cookie-bearing Supabase client, clearing auth cookies, reading the request
// origin, and rendering GoTrue's errors as safe responses. The payload
// schemas, the redirect-URL construction, and the GoTrue calls themselves are
// in auth.service.ts.

import { Router, type Request, type Response } from "express";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  authCookiesAreSecure,
  clearRequestAuthCookies,
  createRequestSupabase,
  publicAuthUser,
} from "../../lib/authSession";
import { microsoftOAuthEnabled } from "../../lib/microsoftOAuth";
import { ssoConfiguration, ssoDomainSchema } from "../../lib/ssoConfig";
import { sendInternalError } from "../../lib/httpError";
import {
  requestOriginIsTrusted,
  requestOriginIsWordAddin,
} from "../../lib/origins";
import { createServerSupabase } from "../../lib/supabase";
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireTrustedOrigin } from "../../middleware/trustedOrigin";
import {
  isMicrosoftConnected,
  persistProviderSessionTokens,
} from "../integrations/integrations.service";
import {
  applyHandoffSession,
  buildCallbackUrl,
  challengeAndVerifyMfa,
  challengeMfaFactor,
  consumeWordHandoff,
  credentialsSchema,
  currentUser,
  emailSchema,
  enrollMfaFactor,
  exchangeCodeForSession,
  exchangeSchema,
  safeNext,
  factorSchema,
  friendlyNameSchema,
  handoffSchema,
  issueWordHandoff,
  listMfaFactors,
  mfaAssuranceLevel,
  passwordSchema,
  sendPasswordReset,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  startGoogleOAuth,
  startMicrosoftOAuth,
  ssoRequestSchema,
  startSsoSignIn,
  unenrollMfaFactor,
  updateEmail,
  updatePassword,
  verificationSchema,
  verifyMfaChallenge,
} from "./auth.service";

export const authRouter = Router();

authRouter.use(requireTrustedOrigin);
authRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

function requestOrigin(req: Request): string {
  return new URL(req.get("origin") as string).origin;
}

function callbackUrl(
  req: Request,
  next: unknown,
  fallback: string,
  path = "/auth/callback",
): string {
  return buildCallbackUrl(requestOrigin(req), next, fallback, path);
}

/**
 * The host that will store the PKCE cookie. The browser's Host is that host.
 * The Origin header can name a different alias, and a callback on the other
 * alias cannot see the cookie.
 */
function browserOrigin(req: Request): string {
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto =
    req.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  if (
    forwardedHost &&
    !forwardedHost.includes("/") &&
    !/[\s@]/.test(forwardedHost)
  ) {
    try {
      const origin = new URL(`${forwardedProto}://${forwardedHost}`).origin;
      if (requestOriginIsTrusted(origin)) return origin;
    } catch {
      // Not a usable host. Fall back to the Origin header.
    }
  }
  return requestOrigin(req);
}

/** No query string: GoTrue matches the redirect allow list against the whole URL. */
function microsoftWebCallback(req: Request): string {
  return new URL("/auth/callback", browserOrigin(req)).toString();
}

function authError(
  res: Response,
  error: unknown,
  fallback = "Authentication could not be completed.",
) {
  const candidate = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
  };
  const suppliedStatus =
    typeof candidate?.status === "number" ? candidate.status : null;
  if (
    suppliedStatus === null ||
    suppliedStatus < 400 ||
    suppliedStatus >= 500
  ) {
    console.error(
      "[auth] unexpected server-side authentication failure",
      error,
    );
    res.status(500).json({
      code: null,
      detail: fallback,
    });
    return;
  }
  res.status(suppliedStatus).json({
    code: typeof candidate?.code === "string" ? candidate.code : null,
    detail:
      typeof candidate?.message === "string" && candidate.message
        ? candidate.message
        : fallback,
  });
}

function invalidBody(res: Response) {
  res.status(400).json({
    code: "invalid_request",
    detail: "The authentication request is invalid.",
  });
}

const OAUTH_PROVIDER_COOKIE = "mike-oauth-provider";
const PKCE_FLOW_COOKIE = "mike-pkce-flow";
const AUTH_NEXT_COOKIE = "mike-auth-next";
const FLOW_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function setOAuthProviderCookie(
  req: Request,
  res: Response,
  provider: "azure" | "",
) {
  const wordAddin = requestOriginIsWordAddin(req.get("origin"));
  res.append(
    "Set-Cookie",
    `${OAUTH_PROVIDER_COOKIE}=${provider}; Path=/; HttpOnly; SameSite=${wordAddin ? "None" : "Lax"}${wordAddin || authCookiesAreSecure() ? "; Secure" : ""}; Max-Age=${provider ? 600 : 0}`,
  );
}

function readNamedCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie ?? "";
  const match = raw
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(name.length + 1));
  } catch {
    return null;
  }
}

function readOAuthProviderCookie(req: Request): string | null {
  return readNamedCookie(req, OAUTH_PROVIDER_COOKIE);
}

function appendNamedCookie(
  req: Request,
  res: Response,
  name: string,
  value: string,
  maxAge: number,
) {
  const wordAddin = requestOriginIsWordAddin(req.get("origin"));
  res.append(
    "Set-Cookie",
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${wordAddin ? "None" : "Lax"}${wordAddin || authCookiesAreSecure() ? "; Secure" : ""}; Max-Age=${maxAge}`,
  );
}

function setPkceFlowCookie(req: Request, res: Response, flowId: string) {
  appendNamedCookie(req, res, PKCE_FLOW_COOKIE, flowId, flowId ? 600 : 0);
}

function readPkceFlowCookie(req: Request): string | undefined {
  const flowId = readNamedCookie(req, PKCE_FLOW_COOKIE);
  return flowId && FLOW_ID_PATTERN.test(flowId) ? flowId : undefined;
}

function setAuthNextCookie(req: Request, res: Response, next: string) {
  appendNamedCookie(req, res, AUTH_NEXT_COOKIE, next, next ? 600 : 0);
}

function readAuthNextCookie(req: Request): string | undefined {
  const next = readNamedCookie(req, AUTH_NEXT_COOKIE);
  if (!next || !next.startsWith("/") || next.startsWith("//")) return undefined;
  return next;
}

async function serializeAuthUser(user: User) {
  try {
    const microsoftConnected = await isMicrosoftConnected(
      createServerSupabase(),
      user,
    );
    return publicAuthUser(user, { microsoftConnected });
  } catch {
    return publicAuthUser(user);
  }
}

function cookieClient(req: Request, res: Response): SupabaseClient | null {
  const client = res.locals.authClient as SupabaseClient | undefined;
  if (!client || res.locals.authSource !== "cookie") {
    res.status(401).json({
      code: "cookie_session_required",
      detail: "A cookie-authenticated session is required.",
    });
    return null;
  }
  return client;
}

authRouter.post("/login", asyncRoute(async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return invalidBody(res);

  try {
    const client = createRequestSupabase(req, res);
    const { data, error } = await signInWithPassword(client, parsed.data);
    if (error || !data.user || !data.session) return authError(res, error);
    res.json({ user: await serializeAuthUser(data.user) });
  } catch (error) {
    authError(res, error);
  }
}));

authRouter.post("/signup", asyncRoute(async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return invalidBody(res);

  try {
    const client = createRequestSupabase(req, res);
    const { data, error } = await signUpWithPassword(
      client,
      parsed.data,
      callbackUrl(req, req.body?.next, "/onboarding/profile"),
    );
    if (error || !data.user) return authError(res, error);
    res.status(201).json({
      user: await serializeAuthUser(data.user),
      requiresEmailConfirmation: !data.session,
    });
  } catch (error) {
    authError(res, error);
  }
}));

async function startSso(req: Request, res: Response) {
  try {
    const config = ssoConfiguration();
    if (!config.enabled) {
      return res
        .status(403)
        .json({
          code: "sso_disabled",
          detail: "Single sign-on is not enabled.",
        });
    }
    const parsed = ssoRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidBody(res);
    const emailDomain = parsed.data.email.slice(
      parsed.data.email.lastIndexOf("@") + 1,
    );
    const parsedDomain = ssoDomainSchema.safeParse(emailDomain);
    if (!parsedDomain.success) return invalidBody(res);
    const domain = parsedDomain.data;
    if (config.allowedDomains && !config.allowedDomains.includes(domain)) {
      return res
        .status(400)
        .json({
          code: "sso_domain_not_allowed",
          detail: "Single sign-on is not available for this domain.",
        });
    }
    const client = createRequestSupabase(req, res);
    const { data, error } = await startSsoSignIn(
      client,
      domain,
      callbackUrl(req, req.body?.next, "/onboarding/profile"),
    );
    if (error) {
      if (error.status && error.status >= 400 && error.status < 500) {
        return res
          .status(400)
          .json({
            code: "sso_unavailable",
            detail: "Unable to start single sign-on for this domain.",
          });
      }
      throw new Error("SSO provider request failed");
    }
    if (!data?.url) throw new Error("Missing SSO redirect");
    return res.json({ url: data.url });
  } catch {
    return sendInternalError(
      res,
      new Error("SSO sign-in could not be started"),
    );
  }
}

authRouter.get("/config", asyncRoute(async (_req, res) => {
  res.json({
    microsoftEnabled: microsoftOAuthEnabled(),
  });
}));

authRouter.post("/oauth", asyncRoute(async (req, res) => {
  if (req.body?.provider === "sso") return startSso(req, res);
  if (req.body?.provider === "azure") {
    if (!microsoftOAuthEnabled()) {
      return res.status(403).json({
        code: "microsoft_oauth_disabled",
        detail: "Microsoft sign-in is not enabled.",
      });
    }
    try {
      const client = createRequestSupabase(req, res);
      const wordDialog = req.body?.callbackPath === "/oauth-dialog.html";
      // The web callback is a bare URL. A `next` query makes GoTrue treat the
      // address as unlisted and send the browser to the other site alias,
      // which does not have this sign-in's PKCE cookie.
      const redirectTo = wordDialog
        ? callbackUrl(
            req,
            req.body?.next,
            "/onboarding/profile",
            "/oauth-dialog.html",
          )
        : microsoftWebCallback(req);
      if (req.body?.intent === "link") {
        const { data: current } = await client.auth.getUser();
        if (!current.user) {
          res.status(401).json({
            code: "cookie_session_required",
            detail: "A cookie-authenticated session is required.",
          });
          return;
        }
      }
      // Reconnect uses the same Azure sign-in as login. linkIdentity
      // requires manual linking, which hosted projects leave disabled, so
      // that call 404s before Microsoft opens.
      const { data, error } = await startMicrosoftOAuth(client, redirectTo);
      if (error || !data.url) return authError(res, error);
      setOAuthProviderCookie(req, res, "azure");
      if (!wordDialog) {
        setAuthNextCookie(
          req,
          res,
          safeNext(req.body?.next, "/onboarding/profile"),
        );
      }
      const flowId = (data as { flowId?: unknown }).flowId;
      if (typeof flowId === "string" && FLOW_ID_PATTERN.test(flowId)) {
        setPkceFlowCookie(req, res, flowId);
      }
      res.json({ url: data.url });
    } catch (error) {
      authError(res, error);
    }
    return;
  }
  if (req.body?.provider !== "google") return invalidBody(res);
  try {
    const client = createRequestSupabase(req, res);
    const { data, error } = await startGoogleOAuth(
      client,
      callbackUrl(
        req,
        req.body?.next,
        "/onboarding/profile",
        req.body?.callbackPath === "/oauth-dialog.html"
          ? "/oauth-dialog.html"
          : "/auth/callback",
      ),
    );
    if (error || !data.url) return authError(res, error);
    setOAuthProviderCookie(req, res, "");
    res.json({ url: data.url });
  } catch (error) {
    authError(res, error);
  }
}));

authRouter.post("/exchange", asyncRoute(async (req, res) => {
  const parsed = exchangeSchema.safeParse(req.body);
  if (!parsed.success) return invalidBody(res);
  try {
    const client = createRequestSupabase(req, res);
    const flowId = readPkceFlowCookie(req);
    const { data, error } = await exchangeCodeForSession(
      client,
      parsed.data.code,
      flowId,
    );
    setPkceFlowCookie(req, res, "");
    if (error || !data.user || !data.session) return authError(res, error);
    if (readOAuthProviderCookie(req) === "azure") {
      await persistProviderSessionTokens(
        createServerSupabase(),
        data.user.id,
        data.session,
      );
      setOAuthProviderCookie(req, res, "");
    }
    if (parsed.data.handoffRequestId) {
      if (!requestOriginIsWordAddin(req.get("origin"))) {
        res.status(403).json({
          code: "word_handoff_origin_required",
          detail: "The authentication handoff origin is not allowed.",
        });
        return;
      }
      const handoffTicket = await issueWordHandoff({
        userId: data.user.id,
        requestId: parsed.data.handoffRequestId,
        origin: requestOrigin(req),
        session: data.session,
      });
      res.json({ handoffTicket });
      return;
    }
    const next = readAuthNextCookie(req);
    setAuthNextCookie(req, res, "");
    res.json({
      user: await serializeAuthUser(data.user),
      ...(next ? { next } : {}),
    });
  } catch (error) {
    authError(res, error);
  }
}));

authRouter.post("/handoff", asyncRoute(async (req, res) => {
  const parsed = handoffSchema.safeParse(req.body);
  if (!parsed.success) return invalidBody(res);
  if (!requestOriginIsWordAddin(req.get("origin"))) {
    res.status(403).json({
      code: "word_handoff_origin_required",
      detail: "The authentication handoff origin is not allowed.",
    });
    return;
  }

  try {
    const handoff = await consumeWordHandoff({
      ticket: parsed.data.ticket,
      requestId: parsed.data.requestId,
      origin: requestOrigin(req),
    });
    if (!handoff) {
      res.status(400).json({
        code: "invalid_auth_handoff",
        detail: "This authentication handoff is invalid or has expired.",
      });
      return;
    }

    const client = createRequestSupabase(req, res);
    const { data, error } = await applyHandoffSession(client, {
      accessToken: handoff.accessToken,
      refreshToken: handoff.refreshToken,
    });
    if (
      error ||
      !data.user ||
      !data.session ||
      data.user.id !== handoff.userId
    ) {
      clearRequestAuthCookies(req, res);
      return authError(
        res,
        error,
        "Authentication handoff could not be completed.",
      );
    }
    res.json({ user: await serializeAuthUser(data.user) });
  } catch (error) {
    authError(res, error, "Authentication handoff could not be completed.");
  }
}));

authRouter.post("/password-reset", asyncRoute(async (req, res) => {
  const email = emailSchema.safeParse(req.body?.email);
  if (email.success) {
    try {
      const client = createRequestSupabase(req, res);
      await sendPasswordReset(
        client,
        email.data,
        callbackUrl(req, "/reset-password", "/reset-password"),
      );
    } catch {
      // Deliberately indistinguishable to prevent account enumeration.
    }
  }
  res.status(204).end();
}));

authRouter.get("/session", requireAuth, asyncRoute(async (_req, res) => {
  const client = cookieClient(_req, res);
  if (!client) return;
  const { user, error } = await currentUser(client);
  if (error || !user) return authError(res, error);
  res.json({ user: await serializeAuthUser(user) });
}));

authRouter.post("/logout", asyncRoute(async (req, res) => {
  try {
    const client = createRequestSupabase(req, res);
    await signOut(client, req.body?.scope === "global" ? "global" : "local");
  } catch (error) {
    // Local cookie removal must not depend on the upstream revocation request.
    console.error("[auth/logout] upstream sign-out failed", error);
  } finally {
    clearRequestAuthCookies(req, res);
  }
  res.status(204).end();
}));

authRouter.patch("/email", requireAuth, asyncRoute(async (req, res) => {
  const email = emailSchema.safeParse(req.body?.email);
  if (!email.success) return invalidBody(res);
  const client = cookieClient(req, res);
  if (!client) return;
  const { data, error } = await updateEmail(
    client,
    email.data,
    callbackUrl(req, req.body?.next, "/settings?emailChange=processed"),
  );
  if (error || !data.user) return authError(res, error);
  res.json({ user: await serializeAuthUser(data.user) });
}));

authRouter.patch("/password", requireAuth, asyncRoute(async (req, res) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return invalidBody(res);
  const client = cookieClient(req, res);
  if (!client) return;
  const { data, error } = await updatePassword(client, parsed.data.password);
  if (error || !data.user) return authError(res, error);
  if (parsed.data.signOut) {
    await signOut(client, "global");
    clearRequestAuthCookies(req, res);
  }
  res.json({ user: await serializeAuthUser(data.user) });
}));

authRouter.get("/mfa/factors", requireAuth, asyncRoute(async (req, res) => {
  const client = cookieClient(req, res);
  if (!client) return;
  const { data, error } = await listMfaFactors(client);
  if (error) return authError(res, error);
  res.json(data);
}));

authRouter.get("/mfa/assurance", requireAuth, asyncRoute(async (req, res) => {
  const client = cookieClient(req, res);
  if (!client) return;
  const { data, error } = await mfaAssuranceLevel(client);
  if (error) return authError(res, error);
  res.json(data);
}));

authRouter.post("/mfa/enroll", requireAuth, asyncRoute(async (req, res) => {
  const friendlyName = friendlyNameSchema.safeParse(req.body?.friendlyName);
  if (!friendlyName.success) return invalidBody(res);
  const client = cookieClient(req, res);
  if (!client) return;
  const { data, error } = await enrollMfaFactor(client, friendlyName.data);
  if (error) return authError(res, error);
  res.status(201).json(data);
}));

authRouter.post("/mfa/challenge", requireAuth, asyncRoute(async (req, res) => {
  const parsed = factorSchema.safeParse(req.body);
  if (!parsed.success) return invalidBody(res);
  const client = cookieClient(req, res);
  if (!client) return;
  const { data, error } = await challengeMfaFactor(client, parsed.data);
  if (error) return authError(res, error);
  res.json(data);
}));

authRouter.post("/mfa/verify", requireAuth, asyncRoute(async (req, res) => {
  const parsed = verificationSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data.challengeId) return invalidBody(res);
  const client = cookieClient(req, res);
  if (!client) return;
  const { data, error } = await verifyMfaChallenge(client, {
    factorId: parsed.data.factorId,
    challengeId: parsed.data.challengeId,
    code: parsed.data.code,
  });
  if (error) return authError(res, error);
  res.json({ user: await serializeAuthUser(data.user) });
}));

authRouter.post("/mfa/challenge-and-verify", requireAuth, asyncRoute(async (req, res) => {
  const parsed = verificationSchema.safeParse(req.body);
  if (!parsed.success) return invalidBody(res);
  const client = cookieClient(req, res);
  if (!client) return;
  const { data, error } = await challengeAndVerifyMfa(client, {
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (error) return authError(res, error);
  res.json({ user: await serializeAuthUser(data.user) });
}));

authRouter.delete("/mfa/factors/:factorId", requireAuth, asyncRoute(async (req, res) => {
  const parsed = factorSchema.safeParse({ factorId: req.params.factorId });
  if (!parsed.success) return invalidBody(res);
  const client = cookieClient(req, res);
  if (!client) return;
  const { data, error } = await unenrollMfaFactor(client, parsed.data);
  if (error) return authError(res, error);
  res.json(data);
}));

authRouter.use(routerErrorHandler("[auth]"));
