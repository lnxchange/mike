import { afterEach, describe, expect, it, vi } from "vitest";

type Part =
  | { type: "start-step" }
  | { type: "finish-step"; finishReason: string }
  | { type: "text-delta"; text: string }
  | { type: "reasoning-start"; id: string }
  | { type: "reasoning-delta"; id: string; text: string }
  | { type: "reasoning-end"; id: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown };

type Run = {
  parts: Part[];
  responseMessages?: unknown[];
};

const streamText = vi.fn();

vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => streamText(...args),
  stepCountIs: (n: number) => ({ stepCountIs: n }),
  jsonSchema: (schema: unknown) => schema,
  tool: (definition: unknown) => definition,
}));

function scriptRuns(runs: Run[]) {
  let index = 0;
  streamText.mockImplementation(() => {
    const run = runs[index] ?? runs[runs.length - 1]!;
    index += 1;
    return {
      stream: (async function* () {
        for (const part of run.parts) yield part;
      })(),
      responseMessages: Promise.resolve(run.responseMessages ?? []),
    };
  });
}

const overrunRun: Run = {
  parts: [
    { type: "start-step" },
    { type: "reasoning-start", id: "r1" },
    { type: "reasoning-delta", id: "r1", text: "thinking..." },
    { type: "finish-step", finishReason: "length" },
  ],
  responseMessages: [
    { role: "assistant", content: [] },
  ],
};

const answerRun: Run = {
  parts: [
    { type: "start-step" },
    { type: "text-delta", text: "Here is the answer." },
    { type: "finish-step", finishReason: "stop" },
  ],
};

async function run(reasoning: "high" | "medium" | undefined) {
  const { streamAiSdk } = await import("../aiSdk");
  const onContentDelta = vi.fn();
  const result = await streamAiSdk(
    {
      model: "claude-sonnet-5",
      systemPrompt: "SYSTEM",
      messages: [{ role: "user", content: "Draft the email." }],
      reasoning,
      maxIterations: 16,
      callbacks: { onContentDelta },
    },
    {
      provider: "claude",
      label: "Claude",
      model: {} as never,
      modelId: "claude-sonnet-5",
      supportsReasoning: true,
      maxOutputTokens: 32_768,
    },
  );
  return { result, onContentDelta };
}

afterEach(() => {
  streamText.mockReset();
});

describe("streamAiSdk reasoning overrun recovery", () => {
  it("retries an empty length step with the run's history, a nudge, and less thinking", async () => {
    scriptRuns([overrunRun, answerRun]);
    const { result, onContentDelta } = await run("high");

    expect(result.fullText).toBe("Here is the answer.");
    expect(onContentDelta).toHaveBeenCalledWith("Here is the answer.");
    expect(streamText).toHaveBeenCalledTimes(2);

    const first = streamText.mock.calls[0]![0] as Record<string, unknown>;
    const second = streamText.mock.calls[1]![0] as Record<string, unknown>;
    expect(first.reasoning).toBe("high");
    expect(first.maxOutputTokens).toBe(32_768);
    expect(first.stopWhen).toEqual({ stepCountIs: 16 });

    expect(second.reasoning).toBe("medium");
    expect(second.stopWhen).toEqual({ stepCountIs: 15 });
    const messages = second.messages as Array<{ role: string; content: unknown }>;
    expect(messages[0]).toEqual({ role: "user", content: "Draft the email." });
    // The empty assistant turn is dropped; the nudge closes the history.
    expect(messages).toHaveLength(2);
    expect(messages[1]!.role).toBe("user");
    expect(String(messages[1]!.content)).toContain("ran out of output room");
  });

  it("keeps this turn's tool calls and results in the retry history", async () => {
    scriptRuns([
      {
        parts: [
          { type: "start-step" },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "read_document",
            input: { doc_id: "doc-1" },
          },
          { type: "finish-step", finishReason: "tool-calls" },
          { type: "start-step" },
          { type: "finish-step", finishReason: "length" },
        ],
        responseMessages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "read_document",
                input: { doc_id: "doc-1" },
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "read_document",
                output: { type: "text", value: "DOCUMENT TEXT" },
              },
            ],
          },
          { role: "assistant", content: "" },
        ],
      },
      answerRun,
    ]);
    const { result } = await run("high");

    expect(result.fullText).toBe("Here is the answer.");
    const second = streamText.mock.calls[1]![0] as Record<string, unknown>;
    const messages = second.messages as Array<{ role: string }>;
    expect(messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "user",
    ]);
    // Two steps were spent before the overrun.
    expect(second.stopWhen).toEqual({ stepCountIs: 14 });
  });

  it("gives up after the retry limit and returns what it has", async () => {
    scriptRuns([overrunRun, overrunRun, overrunRun, answerRun]);
    const { result } = await run("high");

    expect(result.fullText).toBe("");
    expect(streamText).toHaveBeenCalledTimes(3);
    const third = streamText.mock.calls[2]![0] as Record<string, unknown>;
    expect(third.reasoning).toBe("low");
  });

  it("does not retry when the length step produced text", async () => {
    scriptRuns([
      {
        parts: [
          { type: "start-step" },
          { type: "text-delta", text: "Partial answer" },
          { type: "finish-step", finishReason: "length" },
        ],
      },
      answerRun,
    ]);
    const { result } = await run("high");

    expect(result.fullText).toBe("Partial answer");
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  it("retries a create_plan call whose JSON was cut off", async () => {
    let index = 0;
    const runs: Run[] = [
      {
        parts: [
          { type: "start-step" },
          { type: "text-delta", text: "Here is the plan." },
        ],
      },
      answerRun,
    ];
    streamText.mockImplementation(() => {
      const run = runs[index] ?? runs[runs.length - 1]!;
      index += 1;
      return {
        stream: (async function* () {
          for (const part of run.parts) yield part;
          if (index === 1) {
            throw new Error(
              'AI_InvalidToolInputError: Invalid input for tool create_plan: AI_JSONParseError: JSON parsing failed: Text: {"title": "Update the agreement", "items": ',
            );
          }
        })(),
        responseMessages: Promise.resolve([
          { role: "assistant", content: "Here is the plan." },
        ]),
      };
    });

    const { result } = await run("high");

    expect(result.fullText).toBe("Here is the plan.Here is the answer.");
    expect(streamText).toHaveBeenCalledTimes(2);
    const second = streamText.mock.calls[1]![0] as Record<string, unknown>;
    expect(second.reasoning).toBe("medium");
    const messages = second.messages as Array<{ role: string; content: unknown }>;
    expect(messages.at(-1)?.role).toBe("user");
    expect(String(messages.at(-1)?.content)).toContain("create_plan");
    expect(String(messages.at(-1)?.content)).toContain("one short sentence");
  });

  it("does not retry a normal stop", async () => {
    scriptRuns([answerRun, overrunRun]);
    const { result } = await run("high");

    expect(result.fullText).toBe("Here is the answer.");
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  it("leaves reasoning unset when the caller did not ask for it", async () => {
    scriptRuns([overrunRun, answerRun]);
    await run(undefined);

    const second = streamText.mock.calls[1]![0] as Record<string, unknown>;
    expect(second.reasoning).toBe("none");
  });
});
