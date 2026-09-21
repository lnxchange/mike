import { Router } from "express";
import { sendInternalError } from "../../lib/httpError";
import { createServerSupabase } from "../../lib/supabase";
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireTrustedOrigin } from "../../middleware/trustedOrigin";
import {
  azureIdentity,
  deleteMicrosoftTokens,
  isMicrosoftConnected,
} from "./integrations.service";

export const integrationsRouter = Router();

integrationsRouter.use(requireTrustedOrigin);
integrationsRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

integrationsRouter.get(
  "/microsoft",
  requireAuth,
  asyncRoute(async (_req, res) => {
    const client = res.locals.authClient;
    if (!client) {
      res.status(401).json({
        code: "unauthenticated",
        detail: "Authentication is required.",
      });
      return;
    }
    try {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) {
        res.status(401).json({
          code: "unauthenticated",
          detail: "Authentication is required.",
        });
        return;
      }
      const connected = await isMicrosoftConnected(
        createServerSupabase(),
        data.user,
      );
      res.json({ connected });
    } catch (error) {
      sendInternalError(res, error);
    }
  }),
);

integrationsRouter.delete(
  "/microsoft",
  requireAuth,
  asyncRoute(async (_req, res) => {
    const client = res.locals.authClient;
    if (!client) {
      res.status(401).json({
        code: "unauthenticated",
        detail: "Authentication is required.",
      });
      return;
    }
    try {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) {
        res.status(401).json({
          code: "unauthenticated",
          detail: "Authentication is required.",
        });
        return;
      }
      const db = createServerSupabase();
      await deleteMicrosoftTokens(db, data.user.id);
      const identity = azureIdentity(data.user);
      const otherIdentities = (data.user.identities ?? []).filter(
        (item) => item.provider !== "azure",
      );
      if (identity && otherIdentities.length > 0) {
        const unlink = await client.auth.unlinkIdentity(identity);
        if (unlink.error) {
          res.status(400).json({
            code: "microsoft_unlink_failed",
            detail: "Microsoft could not be disconnected from this account.",
          });
          return;
        }
      }
      res.status(204).end();
    } catch (error) {
      sendInternalError(res, error);
    }
  }),
);

integrationsRouter.use(routerErrorHandler("[integrations]"));
