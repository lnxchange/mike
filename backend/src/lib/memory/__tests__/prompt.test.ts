import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMemoryCurrent } = vi.hoisted(() => ({
  getMemoryCurrent: vi.fn(),
}));

vi.mock("../files", () => ({
  getMemoryCurrent: (...args: unknown[]) => getMemoryCurrent(...args),
}));

import { buildMemoryTurn, MEMORY_SYSTEM_POLICY } from "../prompt";

beforeEach(() => {
  getMemoryCurrent.mockReset();
});

describe("buildMemoryTurn", () => {
  it("loads app and project memory in parallel", async () => {
    let resolveApp!: (value: unknown) => void;
    let resolveProject!: (value: unknown) => void;
    getMemoryCurrent
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveApp = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveProject = resolve;
        }),
      );

    const pending = buildMemoryTurn({
      db: {} as never,
      systemPrompt: "BASE",
      userId: "user-1",
      projectId: "project-1",
    });

    expect(getMemoryCurrent).toHaveBeenCalledTimes(2);
    resolveApp({ current: { enabled: true, content: "App" } });
    resolveProject({ current: { enabled: true, content: "Project" } });
    await expect(pending).resolves.toMatchObject({
      message: { content: expect.stringContaining("Project") },
    });
  });

  it("withholds app memory from a shared project conversation", async () => {
    getMemoryCurrent.mockResolvedValueOnce({
      current: { enabled: true, content: "# Project\n- Matter Alpha" },
    });

    const turn = await buildMemoryTurn({
      db: {} as never,
      systemPrompt: "BASE",
      userId: "user-1",
      projectId: "project-1",
      sharedAudience: true,
    });

    expect(MEMORY_SYSTEM_POLICY).toContain(
      "current conversation over project memory",
    );
    expect(MEMORY_SYSTEM_POLICY).toContain("project memory over org memory");
    expect(MEMORY_SYSTEM_POLICY).toContain("org memory over app memory");
    expect(turn.message?.content).not.toContain('scope="app"');
    expect(turn.message?.content).toContain('scope="project"');
    expect(turn.message?.content).toContain("# Project");
    expect(turn.message?.content).toContain("CONVERSATION AUDIENCE: SHARED");
    expect(MEMORY_SYSTEM_POLICY).toContain("never grants permissions");
    expect(MEMORY_SYSTEM_POLICY).toContain(
      "never included in a shared-audience conversation",
    );
    expect(MEMORY_SYSTEM_POLICY).toContain("Where the matter sits");
    expect(MEMORY_SYSTEM_POLICY).toContain(
      "Stale notes about missing tools do not override the tools listed in this prompt",
    );
    expect(getMemoryCurrent).toHaveBeenCalledTimes(1);
    expect(getMemoryCurrent).toHaveBeenCalledWith(
      expect.anything(),
      "project",
      "project-1",
    );
  });

  it("does not load app memory for a shared standalone conversation", async () => {
    const shared = await buildMemoryTurn({
      db: {} as never,
      systemPrompt: "BASE",
      userId: "user-1",
      sharedAudience: true,
    });

    expect(shared.systemPrompt).toContain("BASE");
    expect(shared).toEqual({ message: null, systemPrompt: "BASE" });
    expect(getMemoryCurrent).not.toHaveBeenCalled();

    getMemoryCurrent.mockReset();
    getMemoryCurrent.mockResolvedValueOnce({
      current: { enabled: true, content: "# App" },
    });
    const private_ = await buildMemoryTurn({
      db: {} as never,
      systemPrompt: "BASE",
      userId: "user-1",
    });
    expect(private_.systemPrompt).toContain(
      "CURRENT MEMORY AUDIENCE: PRIVATE TO THE ACTIVE USER",
    );
    expect(private_.message?.content).toContain("# App");
  });

  it("injects org memory for a shared project that belongs to an org", async () => {
    const db = {
      from() {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { org_id: "org-1" },
                error: null,
              }),
            }),
          }),
        };
      },
    };
    getMemoryCurrent
      .mockResolvedValueOnce({
        current: { enabled: true, content: "# Firm house file" },
      })
      .mockResolvedValueOnce({
        current: { enabled: true, content: "# Matter Alpha" },
      });

    const turn = await buildMemoryTurn({
      db: db as never,
      systemPrompt: "BASE",
      userId: "user-1",
      projectId: "project-1",
      sharedAudience: true,
    });

    expect(getMemoryCurrent).toHaveBeenCalledTimes(2);
    expect(getMemoryCurrent).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "org",
      "org-1",
    );
    expect(getMemoryCurrent).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "project",
      "project-1",
    );
    expect(turn.message?.content).toContain('scope="org"');
    expect(turn.message?.content).toContain("# Firm house file");
    expect(turn.message?.content).toContain('scope="project"');
    expect(turn.message?.content).not.toContain('scope="app"');
  });

  it("leaves the prompt untouched for a surface that opts out", async () => {
    await expect(
      buildMemoryTurn({
        db: {} as never,
        systemPrompt: "BASE",
        userId: "user-1",
        include: false,
      }),
    ).resolves.toEqual({ message: null, systemPrompt: "BASE" });
    expect(getMemoryCurrent).not.toHaveBeenCalled();
  });

  it("omits disabled content and contains strict read failures", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getMemoryCurrent
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValueOnce({
        current: { enabled: false, content: "must not appear" },
      });

    await expect(
      buildMemoryTurn({
        db: {} as never,
        systemPrompt: "BASE",
        userId: "user-1",
        projectId: "project-1",
      }),
    ).resolves.toMatchObject({ message: null, systemPrompt: "BASE" });
    expect(warn).toHaveBeenCalledWith(
      "[memory-context] scoped memory could not be loaded",
      { scope: "app" },
    );
    warn.mockRestore();
  });
});
