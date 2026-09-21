import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrgRole: vi.fn(),
  checkProjectAccess: vi.fn(),
  fetch: vi.fn(),
  createServerSupabase: vi.fn(() => ({})),
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    res.locals.userId = "11111111-1111-4111-8111-111111111111";
    res.locals.userEmail = "lawyer@attune.legal";
    next();
  },
}));

vi.mock("../../lib/supabase", () => ({
  createServerSupabase: mocks.createServerSupabase,
}));

vi.mock("../../lib/access", () => ({
  getOrgRole: mocks.getOrgRole,
  checkProjectAccess: mocks.checkProjectAccess,
}));

import { integrationsRouter } from "../../modules/integrations/integrations.routes";

const app = express();
app.use(express.json());
app.use("/integrations", integrationsRouter);

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

function filerResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function configureFiler() {
  process.env.FILER_BASE_URL = "https://filer.example.net/";
  process.env.FILER_FUNCTION_KEY = "secret-key";
  process.env.MATTER_SYNC_ORG_ID = ORG_ID;
}

function mockMatterDb(options?: {
  project?: {
    cm_number?: string | null;
    zoho_deal_id?: string | null;
    sharepoint_folder_url?: string | null;
  };
  documentUrls?: string[];
  onUpdate?: (payload: Record<string, unknown>) => void;
}) {
  return {
    from: (table: string) => {
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: options?.project ?? {
                  cm_number: null,
                  zoho_deal_id: null,
                  sharepoint_folder_url: null,
                },
                error: null,
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            options?.onUpdate?.(payload);
            return { eq: async () => ({ data: null, error: null }) };
          },
        };
      }
      if (table === "documents") {
        return {
          select: () => ({
            eq: () => ({
              limit: async () => ({
                data: (options?.documentUrls ?? []).map((url) => ({
                  external_web_url: url,
                })),
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe("integrations routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    configureFiler();
    mocks.createServerSupabase.mockReturnValue(mockMatterDb());
    mocks.getOrgRole.mockResolvedValue("member");
    mocks.checkProjectAccess.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FILER_BASE_URL;
    delete process.env.FILER_FUNCTION_KEY;
    delete process.env.MATTER_SYNC_ORG_ID;
  });

  it("searches matters through the filer with the function key", async () => {
    mocks.fetch.mockResolvedValue(
      filerResponse(200, {
        matters: [
          {
            id: "deal-1",
            matterNumber: "263334",
            name: "Intellihub - VAPs",
            account: "Blue NRG",
            status: "Open",
            hasFolder: true,
          },
          { junk: true },
        ],
      }),
    );

    const response = await request(app)
      .get("/integrations/matters/search")
      .query({ q: "intelli" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      matters: [
        {
          id: "deal-1",
          matterNumber: "263334",
          name: "Intellihub - VAPs",
          account: "Blue NRG",
          status: "Open",
          hasFolder: true,
        },
      ],
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://filer.example.net/api/colleague");
    expect((init.headers as Record<string, string>)["x-functions-key"]).toBe(
      "secret-key",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      action: "search",
      q: "intelli",
    });
    expect(mocks.getOrgRole).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      ORG_ID,
      expect.anything(),
    );
  });

  it("rejects a search shorter than two characters before calling the filer", async () => {
    const response = await request(app)
      .get("/integrations/matters/search")
      .query({ q: "a" });

    expect(response.status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("pulls a matter and passes the requester's email", async () => {
    mocks.fetch.mockResolvedValue(
      filerResponse(200, {
        projectId: PROJECT_ID,
        created: true,
        matterNumber: "263334",
        matterName: "Intellihub - VAPs",
        account: "Blue NRG Pty Ltd",
        description: "Intellihub - VAPs",
        uploaded: 12,
        remaining: 40,
        status: "Syncing",
      }),
    );

    const response = await request(app)
      .post("/integrations/matters/pull")
      .send({ matterId: "deal-1" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      projectId: PROJECT_ID,
      created: true,
      matterNumber: "263334",
      matterName: "Intellihub - VAPs",
      account: "Blue NRG Pty Ltd",
      description: "Intellihub - VAPs",
      uploaded: 12,
      remaining: 40,
      status: "Syncing",
      matterId: null,
      sharepointFolderUrl: null,
    });
    const [, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      action: "pull",
      matterId: "deal-1",
      requestedBy: "lawyer@attune.legal",
    });
  });

  it("re-syncs by matter number for an existing matter page", async () => {
    mocks.fetch.mockResolvedValue(
      filerResponse(200, {
        projectId: PROJECT_ID,
        created: false,
        uploaded: 0,
        remaining: 0,
        status: "Idle",
      }),
    );

    const response = await request(app)
      .post("/integrations/matters/pull")
      .send({ matterNumber: "263334", mode: "incremental" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ created: false, status: "Idle" });
    const [, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      action: "pull",
      matterNumber: "263334",
      requestedBy: "lawyer@attune.legal",
      mode: "incremental",
    });
  });

  it("maps the filer's 409 onto a 409 with the folder-not-ready message and no filer text", async () => {
    mocks.fetch.mockResolvedValue(
      filerResponse(409, {
        error: "Deal 123 has no easysharepointforcrm folder id yet",
        status: "AwaitingFolder",
      }),
    );

    const response = await request(app)
      .post("/integrations/matters/pull")
      .send({ matterId: "deal-1" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      code: "awaiting_folder",
      detail:
        "The SharePoint folder for this matter has not been created yet. It will sync automatically once it appears.",
    });
    expect(JSON.stringify(response.body)).not.toContain("easysharepoint");
  });

  it("maps a filer 200 without projectId to 503 and does not 500", async () => {
    mocks.fetch.mockResolvedValue(
      filerResponse(200, {
        folderResolved: true,
        driveId: "b!drive",
        folderItemId: "01FOLDER",
        created: false,
      }),
    );

    const response = await request(app)
      .post("/integrations/matters/pull")
      .send({ matterId: "deal-1" });

    expect(response.status).toBe(503);
    expect(response.body.detail).toBe(
      "The matter could not be created in Libris Colleague. Please try again shortly.",
    );
    expect(JSON.stringify(response.body)).not.toContain("folderResolved");
    expect(JSON.stringify(response.body)).not.toContain("projectId");
  });

  it("maps the filer's 404 and 400 onto intentional messages", async () => {
    mocks.fetch.mockResolvedValueOnce(
      filerResponse(404, { error: "Deal not found: stack trace here" }),
    );
    const missing = await request(app)
      .post("/integrations/matters/pull")
      .send({ matterId: "deal-x" });
    expect(missing.status).toBe(404);
    expect(missing.body.detail).toBe("That matter was not found in Zoho.");

    mocks.fetch.mockResolvedValueOnce(
      filerResponse(400, { error: "matterId must be numeric" }),
    );
    const invalid = await request(app)
      .post("/integrations/matters/pull")
      .send({ matterId: "deal-x" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.detail).not.toContain("numeric");
  });

  it("answers 503 with a plain message when the filer is not configured", async () => {
    delete process.env.FILER_BASE_URL;

    const response = await request(app)
      .post("/integrations/matters/pull")
      .send({ matterId: "deal-1" });

    expect(response.status).toBe(503);
    expect(response.body.detail).toBe(
      "Pulling matters from Zoho is not set up on this deployment.",
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.getOrgRole).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not a member of the matter-sync organisation", async () => {
    mocks.getOrgRole.mockResolvedValue(null);

    const response = await request(app)
      .post("/integrations/matters/pull")
      .send({ matterId: "deal-1" });

    expect(response.status).toBe(403);
    expect(response.body.detail).toBe(
      "Only members of the matter-sync organisation can pull matters from Zoho.",
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("answers 503 without leaking detail when the filer cannot be reached", async () => {
    mocks.fetch.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.1:443"));

    const response = await request(app)
      .get("/integrations/matters/search")
      .query({ q: "intelli" });

    expect(response.status).toBe(503);
    expect(response.body.detail).toBe(
      "The matter sync service did not respond. Please try again shortly.",
    );
    expect(JSON.stringify(response.body)).not.toContain("ECONNREFUSED");
  });

  it("returns the sync row for a project the caller can access", async () => {
    mocks.fetch.mockResolvedValue(
      filerResponse(200, {
        found: true,
        status: "Syncing",
        matterNumber: "263334",
        matterName: "Intellihub - VAPs",
        documentCount: 34,
        remaining: 86,
        lastSyncAt: "2026-09-20T00:00:00Z",
        lastChangeAt: null,
        lastError: null,
      }),
    );

    const response = await request(app).get(
      `/integrations/matters/status/${PROJECT_ID}`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      found: true,
      status: "Syncing",
      matterNumber: "263334",
      matterName: "Intellihub - VAPs",
      documentCount: 34,
      remaining: 86,
      lastSyncAt: "2026-09-20T00:00:00Z",
      lastChangeAt: null,
      lastError: null,
      matterId: null,
      sharepointFolderUrl: null,
    });
    expect(mocks.checkProjectAccess).toHaveBeenCalledWith(
      PROJECT_ID,
      "11111111-1111-4111-8111-111111111111",
      "lawyer@attune.legal",
      expect.anything(),
    );
  });

  it("hides the status of a project the caller cannot access", async () => {
    mocks.checkProjectAccess.mockResolvedValue({ ok: false });

    const response = await request(app).get(
      `/integrations/matters/status/${PROJECT_ID}`,
    );

    expect(response.status).toBe(404);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("writes Zoho and SharePoint links onto the project after a pull", async () => {
    const updates: Record<string, unknown>[] = [];
    mocks.createServerSupabase.mockReturnValue(mockMatterDb({ onUpdate: (payload) => updates.push(payload) }));
    mocks.fetch.mockResolvedValue(
      filerResponse(200, {
        projectId: PROJECT_ID,
        created: true,
        matterNumber: "263334",
        matterName: "Intellihub - VAPs",
        uploaded: 1,
        remaining: 0,
        status: "Idle",
        matterId: "deal-1",
        sharepointFolderUrl:
          "https://attunelegal.sharepoint.com/sites/AttuneLegal/matter",
      }),
    );

    const response = await request(app)
      .post("/integrations/matters/pull")
      .send({ matterId: "deal-1" });

    expect(response.status).toBe(200);
    expect(response.body.matterId).toBe("deal-1");
    expect(response.body.sharepointFolderUrl).toBe(
      "https://attunelegal.sharepoint.com/sites/AttuneLegal/matter",
    );
    expect(updates).toEqual([
      expect.objectContaining({
        zoho_deal_id: "deal-1",
        sharepoint_folder_url:
          "https://attunelegal.sharepoint.com/sites/AttuneLegal/matter",
      }),
    ]);
  });

  it("fills missing project links from a status read", async () => {
    const updates: Record<string, unknown>[] = [];
    mocks.createServerSupabase.mockReturnValue(
      mockMatterDb({ onUpdate: (payload) => updates.push(payload) }),
    );
    mocks.fetch.mockResolvedValue(
      filerResponse(200, {
        found: true,
        status: "Idle",
        matterNumber: "263334",
        matterName: "Intellihub - VAPs",
        documentCount: 12,
        remaining: 0,
        lastSyncAt: null,
        lastChangeAt: null,
        lastError: null,
        matterId: "deal-1",
        sharepointFolderUrl:
          "https://attunelegal.sharepoint.com/sites/AttuneLegal/matter",
      }),
    );

    const response = await request(app).get(
      `/integrations/matters/status/${PROJECT_ID}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.matterId).toBe("deal-1");
    expect(updates).toEqual([
      expect.objectContaining({
        zoho_deal_id: "deal-1",
        sharepoint_folder_url:
          "https://attunelegal.sharepoint.com/sites/AttuneLegal/matter",
      }),
    ]);
  });

  it("fills links from a Zoho search and mirrored file URLs when the filer omits them", async () => {
    const updates: Record<string, unknown>[] = [];
    mocks.createServerSupabase.mockReturnValue(
      mockMatterDb({
        project: { cm_number: "242814", zoho_deal_id: null, sharepoint_folder_url: null },
        documentUrls: [
          "https://attunelegal.sharepoint.com/sites/AttuneLegal/_layouts/15/Doc.aspx?sourcedoc=abc",
          "https://attunelegal.sharepoint.com/sites/AttuneLegal/Shared%20Documents/Clients/Blue%20NRG/23-0011%20-%20ACCC/note.eml",
          "https://attunelegal.sharepoint.com/sites/AttuneLegal/Shared%20Documents/Clients/Blue%20NRG/23-0011%20-%20ACCC/Emails%20-%20ACCC/other.eml",
        ],
        onUpdate: (payload) => updates.push(payload),
      }),
    );
    mocks.fetch.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as {
        action?: string;
      };
      if (body.action === "search") {
        return filerResponse(200, {
          matters: [
            {
              id: "3849704000030080744",
              matterNumber: "242814",
              name: "ACCC - s155 Notice and Enforcement",
              hasFolder: true,
            },
          ],
        });
      }
      return filerResponse(200, {
        found: true,
        status: "Syncing",
        matterNumber: "242814",
        matterName: "ACCC - s155 Notice and Enforcement",
        documentCount: 34,
        remaining: 86,
        lastSyncAt: null,
        lastChangeAt: null,
        lastError: null,
      });
    });

    const response = await request(app).get(
      `/integrations/matters/status/${PROJECT_ID}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.matterId).toBe("3849704000030080744");
    expect(response.body.sharepointFolderUrl).toBe(
      "https://attunelegal.sharepoint.com/sites/AttuneLegal/Shared%20Documents/Clients/Blue%20NRG/23-0011%20-%20ACCC",
    );
    expect(updates).toEqual([
      expect.objectContaining({
        zoho_deal_id: "3849704000030080744",
        sharepoint_folder_url:
          "https://attunelegal.sharepoint.com/sites/AttuneLegal/Shared%20Documents/Clients/Blue%20NRG/23-0011%20-%20ACCC",
      }),
    ]);
  });

  it("reports found:false when the matter has no sync row", async () => {
    mocks.fetch.mockResolvedValue(filerResponse(200, { found: false }));

    const response = await request(app).get(
      `/integrations/matters/status/${PROJECT_ID}`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ found: false });
  });
});
