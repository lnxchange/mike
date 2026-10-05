import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/log", () => ({
  logError: vi.fn(),
}));

import {
  graphSearchParameter,
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
