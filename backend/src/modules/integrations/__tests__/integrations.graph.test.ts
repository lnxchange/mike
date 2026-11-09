import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/log", () => ({
  logError: vi.fn(),
}));

import {
  graphSearchParameter,
  listInlineFileAttachments,
  listRecentSentMessageBodies,
  searchMailboxMessages,
} from "../integrations.graph";

describe("graphSearchParameter", () => {
  it("wraps keywords once and strips nested quotes", () => {
    expect(graphSearchParameter("Schedule AND alissa@example.com")).toBe(
      '"Schedule AND alissa@example.com"',
    );
    expect(graphSearchParameter('"Schedule" AND "alissa@example.com"')).toBe(
      '"Schedule AND alissa@example.com"',
    );
  });
});

describe("searchMailboxMessages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a single quoted $search value", async () => {
    const expectedSearch = new URLSearchParams({
      $search: '"Schedule AND alissa@example.com"',
    }).toString();
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain(expectedSearch);
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      searchMailboxMessages("token", '"Schedule" AND "alissa@example.com"'),
    ).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws GraphRequestError with status and code on a non-401 failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({ error: { code: "SearchWithFilter" } }),
          { status: 400 },
        );
      }),
    );

    await expect(
      searchMailboxMessages("token", "Schedule"),
    ).rejects.toMatchObject({
      name: "GraphRequestError",
      status: 400,
      graphCode: "SearchWithFilter",
      operation: "/me/messages",
    });
  });
});

describe("listRecentSentMessageBodies", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sorts by a selected sentDateTime and reads each full body", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/sentitems/messages")) {
        expect(String(url)).toContain("sentDateTime");
        expect(String(url)).not.toContain("uniqueBody");
        return new Response(JSON.stringify({ value: [{ id: "sent-1" }] }), {
          status: 200,
        });
      }
      expect(String(url)).toContain("/messages/sent-1");
      expect(String(url)).toContain("body");
      return new Response(
        JSON.stringify({
          body: {
            content:
              '<p>Kind regards,</p><div id="Signature">Yule Guttenbeil Principal</div>',
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listRecentSentMessageBodies("token")).resolves.toEqual([
      {
        id: "sent-1",
        html: '<p>Kind regards,</p><div id="Signature">Yule Guttenbeil Principal</div>',
      },
    ]);
    const bodyCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("/messages/sent-1"),
    );
    expect(bodyCall?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Prefer: expect.stringContaining("outlook.allow-unsafe-html"),
      }),
    });
  });
});

describe("listInlineFileAttachments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads inline image bytes from the attachment itself", async () => {
    const png = Buffer.from("png").toString("base64");
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/attachments/logo-1")) {
        return new Response(
          JSON.stringify({
            name: "attune-logo.png",
            contentType: "image/png",
            contentBytes: png,
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          value: [
            {
              id: "logo-1",
              name: "attune-logo.png",
              contentType: "image/png",
              contentId: "attune-logo",
              isInline: true,
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const attachments = await listInlineFileAttachments("token", "sent-1");
    expect(attachments).toEqual([
      expect.objectContaining({
        filename: "attune-logo.png",
        contentId: "attune-logo",
        isInline: true,
        bytes: Buffer.from("png"),
      }),
    ]);
  });
});
