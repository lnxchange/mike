// HTTP layer for the integrations module: the Zoho matter pull and sync
// status surface Libris Colleague exposes to its own UI.
//
//   GET  /integrations/matters/search?q=          -> { matters }
//   POST /integrations/matters/pull { matterId | matterNumber, mode? }
//   GET  /integrations/matters/status/:projectId  -> sync row or found:false
//
// Handlers read the caller off res.locals, hand the raw input to the service,
// and map its `ServiceResult` onto a status code and body.

import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { createServerSupabase } from "../../lib/supabase";
import { sendInternalError } from "../../lib/httpError";
import { sendServiceFailure } from "../../lib/serviceResult";
import {
  azureIdentity,
  deleteMicrosoftTokens,
  getMatterSyncStatus,
  isMicrosoftConnected,
  pullZohoMatter,
  searchZohoMatters,
} from "./integrations.service";

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth);

integrationsRouter.get(
  "/matters/search",
  asyncRoute(async (req, res) => {
    const result = await searchZohoMatters(createServerSupabase(), {
      userId: res.locals.userId as string,
      q: req.query.q,
    });
    if (!result.ok) return void sendServiceFailure(res, result);
    res.json(result.data);
  }),
);

integrationsRouter.post(
  "/matters/pull",
  asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await pullZohoMatter(createServerSupabase(), {
      userId: res.locals.userId as string,
      userEmail: res.locals.userEmail as string | undefined,
      matterId: body.matterId,
      matterNumber: body.matterNumber,
      mode: body.mode,
    });
    if (!result.ok) return void sendServiceFailure(res, result);
    res.json(result.data);
  }),
);

integrationsRouter.get(
  "/matters/status/:projectId",
  asyncRoute(async (req, res) => {
    const result = await getMatterSyncStatus(createServerSupabase(), {
      userId: res.locals.userId as string,
      userEmail: res.locals.userEmail as string | undefined,
      projectId: req.params.projectId,
    });
    if (!result.ok) return void sendServiceFailure(res, result);
    res.json(result.data);
  }),
);

integrationsRouter.get(
  "/microsoft",
  asyncRoute(async (_req, res) => {
    const client = res.locals.authClient as SupabaseClient | undefined;
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
  asyncRoute(async (_req, res) => {
    const client = res.locals.authClient as SupabaseClient | undefined;
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
