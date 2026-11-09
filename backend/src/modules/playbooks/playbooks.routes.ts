import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { createServerSupabase } from "../../lib/supabase";
import { sendServiceFailure } from "../../lib/serviceResult";
import {
    compilePlaybook,
    createPlaybook,
    getPlaybook,
    listPlaybooks,
    runPlaybookReview,
    sharePlaybook,
    updatePlaybook,
    type PlaybookContent,
} from "./playbooks.service";

export const playbooksRouter = Router();

playbooksRouter.get("/", requireAuth, asyncRoute(async (_req, res) => {
    const result = await listPlaybooks(
        createServerSupabase(),
        res.locals.userId as string,
    );
    if (!result.ok) return void sendServiceFailure(res, result);
    res.json(result.data);
}));

playbooksRouter.post("/", requireAuth, asyncRoute(async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    const orgId = typeof req.body?.orgId === "string" ? req.body.orgId : null;
    const description =
        typeof req.body?.description === "string" ? req.body.description : undefined;
    const result = await createPlaybook(createServerSupabase(), res.locals.userId as string, {
        name,
        orgId,
        description,
    });
    if (!result.ok) return void sendServiceFailure(res, result);
    res.status(201).json(result.data);
}));

playbooksRouter.post("/import", requireAuth, asyncRoute(async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    const sourceText =
        typeof req.body?.sourceText === "string" ? req.body.sourceText : "";
    const orgId = typeof req.body?.orgId === "string" ? req.body.orgId : null;
    const result = await compilePlaybook(
        createServerSupabase(),
        res.locals.userId as string,
        { name, orgId, sourceText },
    );
    if (!result.ok) return void sendServiceFailure(res, result);
    res.status(201).json(result.data);
}));

playbooksRouter.get("/:playbookId", requireAuth, asyncRoute(async (req, res) => {
    const result = await getPlaybook(
        createServerSupabase(),
        res.locals.userId as string,
        req.params.playbookId,
    );
    if (!result.ok) return void sendServiceFailure(res, result);
    res.json(result.data);
}));

playbooksRouter.put("/:playbookId", requireAuth, asyncRoute(async (req, res) => {
    const body = req.body ?? {};
    const result = await updatePlaybook(
        createServerSupabase(),
        res.locals.userId as string,
        req.params.playbookId,
        {
            name: typeof body.name === "string" ? body.name : undefined,
            description:
                typeof body.description === "string" || body.description === null
                    ? body.description
                    : undefined,
            representedParty:
                typeof body.representedParty === "string" ||
                body.representedParty === null
                    ? body.representedParty
                    : undefined,
            visibility:
                body.visibility === "public" || body.visibility === "private"
                    ? body.visibility
                    : undefined,
            content: body.content as PlaybookContent | undefined,
        },
    );
    if (!result.ok) return void sendServiceFailure(res, result);
    res.json(result.data);
}));

playbooksRouter.post(
    "/:playbookId/shares",
    requireAuth,
    asyncRoute(async (req, res) => {
        const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
        const role = req.body?.role === "editor" ? "editor" : "viewer";
        if (!userId) {
            return void res.status(400).json({ detail: "userId is required" });
        }
        const result = await sharePlaybook(
            createServerSupabase(),
            res.locals.userId as string,
            req.params.playbookId,
            { userId, role },
        );
        if (!result.ok) return void sendServiceFailure(res, result);
        res.json(result.data);
    }),
);

playbooksRouter.post(
    "/:playbookId/reviews",
    requireAuth,
    asyncRoute(async (req, res) => {
        const documentId =
            typeof req.body?.documentId === "string" ? req.body.documentId : "";
        if (!documentId) {
            return void res.status(400).json({ detail: "documentId is required" });
        }
        const result = await runPlaybookReview(createServerSupabase(), {
            userId: res.locals.userId as string,
            userEmail: res.locals.userEmail as string | undefined,
            playbookId: req.params.playbookId,
            documentId,
            mode: req.body?.mode === "permissive" ? "permissive" : "strict",
        });
        if (!result.ok) return void sendServiceFailure(res, result);
        res.json(result.data);
    }),
);

playbooksRouter.use(routerErrorHandler("[playbooks]"));
