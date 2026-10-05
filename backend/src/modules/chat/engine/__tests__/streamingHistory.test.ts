import { beforeEach, describe, expect, it, vi } from "vitest";

// Declaring the stub's parameter (rather than a zero-arity `vi.fn`) is what
// lets tsc check the `mock.calls[0][0]` lookup below; with an empty call tuple
// every assertion on it type-checks vacuously.
type StreamChatCall = {
  systemPrompt: string;
  messages: { role: string; content: string }[];
  [key: string]: unknown;
};

const { streamChatWithTools } = vi.hoisted(() => ({
  streamChatWithTools: vi.fn(async (_params: StreamChatCall) => ({
    fullText: "",
  })),
}));

vi.mock("../../../../lib/llm", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../../../../lib/llm/models")),
  streamChatWithTools: (params: StreamChatCall) => streamChatWithTools(params),
  completeText: vi.fn(),
}));
vi.mock("../../../../lib/mcpConnectors", () => ({
  buildUserMcpTools: vi.fn(async () => []),
}));
vi.mock("../tools/toolDispatcher", () => ({
  runToolCalls: vi.fn(),
}));

import { runLLMStream } from "../streaming";

beforeEach(() => {
  vi.clearAllMocks();
  streamChatWithTools.mockResolvedValue({ fullText: "" });
});

describe("runLLMStream history", () => {
  it("drops assistant turns that carry no text so no provider sees an empty block", async () => {
    // A cancelled or errored turn, or a client that keeps prose in events,
    // replays as content "". Anthropic rejects the whole request over one
    // such block ("text content blocks must be non-empty").
    await runLLMStream({
      model: "gemini-3-flash-preview",
      apiMessages: [
        { role: "system", content: "SYSTEM" },
        { role: "user", content: "first" },
        { role: "assistant", content: "" },
        { role: "user", content: "second" },
        { role: "assistant", content: "kept" },
        { role: "user", content: "third" },
      ],
      docStore: new Map(),
      docIndex: {},
      userId: "u1",
      db: {} as never,
      write: vi.fn(),
    });
    const params = streamChatWithTools.mock.calls[0]![0];
    expect(params.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "first"],
      ["user", "second"],
      ["assistant", "kept"],
      ["user", "third"],
    ]);
  });

  it("does not end a request on an assistant message", async () => {
    // Claude Opus 5 rejects assistant prefill. A plan slice replays the
    // transcript it is continuing, which ends on that assistant turn.
    await runLLMStream({
      model: "gemini-3-flash-preview",
      apiMessages: [
        { role: "system", content: "SYSTEM" },
        { role: "user", content: "Draft the email." },
        { role: "assistant", content: "I will start with the schedule." },
      ],
      docStore: new Map(),
      docIndex: {},
      userId: "u1",
      db: {} as never,
      write: vi.fn(),
    });
    const params = streamChatWithTools.mock.calls[0]![0];
    expect(params.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "Draft the email."],
      ["assistant", "I will start with the schedule."],
      ["user", "Continue."],
    ]);
  });

  it("keeps thinking that arrives without a closing block", async () => {
    const write = vi.fn();
    streamChatWithTools.mockImplementation(async (params: StreamChatCall) => {
      const callbacks = params.callbacks as
        | { onReasoningDelta?: (delta: string) => void }
        | undefined;
      callbacks?.onReasoningDelta?.("Looking at the schedule.");
      return { fullText: "" };
    });
    const result = await runLLMStream({
      model: "gemini-3-flash-preview",
      apiMessages: [
        { role: "system", content: "SYSTEM" },
        { role: "user", content: "What did they say?" },
      ],
      docStore: new Map(),
      docIndex: {},
      userId: "u1",
      db: {} as never,
      write,
    });
    expect(result.events).toContainEqual({
      type: "reasoning",
      text: "Looking at the schedule.",
    });
    expect(write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ type: "reasoning_block_end" })}\n\n`,
    );
  });
});
