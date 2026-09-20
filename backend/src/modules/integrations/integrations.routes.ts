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
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { createServerSupabase } from "../../lib/supabase";
import { sendServiceFailure } from "../../lib/serviceResult";
import {
  getMatterSyncStatus,
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

integrationsRouter.use(routerErrorHandler("[integrations]"));
