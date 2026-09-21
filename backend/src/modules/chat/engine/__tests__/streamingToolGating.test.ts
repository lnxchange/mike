import { beforeEach, describe, expect, it, vi } from "vitest";

// The tool loop is the second door into a project's documents. Standing in a
// CHAT (its creator, or an email on its share list) is not standing in the
// project whose documents edit_document / replicate_document / generate_*
// would write, so routes pass `allowDocumentMutation: false` for a caller who
// may talk in the thread but not edit the container. These pin both halves of
// that gate: the schemas the model is shown, and what happens if it asks for
// a writer anyway.

const { streamChatWithTools, runToolCalls } = vi.hoisted(() => ({
  streamChatWithTools: vi.fn(async (_params: StreamChatCall) => ({
    fullText: "",
  })),
  runToolCalls: vi.fn(async (_calls: { function: { name: string } }[]) => ({
    toolResults: [],
    docsRead: [],
    docsFound: [],
    docsCreated: [],
    docsReplicated: [],
    docsFinalized: [],
    workflowsApplied: [],
    docsEdited: [],
    askInputsEvents: [],
    courtlistenerEvents: [],
    caseCitationEvents: [],
    auLegislationEvents: [],
    auEnergyEvents: [],
    auVicLegislationEvents: [],
    auCaseLawEvents: [],
    legislationCitationEvents: [],
    mcpEvents: [],
  })),
}));

vi.mock("../../../../lib/llm", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../../../../lib/llm/models")),
  DEFAULT_STREAM_MAX_ITERATIONS: 16,
  streamChatWithTools: (params: StreamChatCall) => streamChatWithTools(params),
  completeText: vi.fn(),
}));

vi.mock("../../../../lib/mcpConnectors", () => ({
  buildUserMcpTools: vi.fn(async () => []),
}));

vi.mock("../tools/toolDispatcher", () => ({
  runToolCalls: (calls: { function: { name: string } }[]) =>
    runToolCalls(calls),
}));

vi.mock("../../../../lib/memory/prompt", () => ({
  buildMemoryTurn: async (args: { systemPrompt: string }) => ({
    message: null,
    systemPrompt: args.systemPrompt,
  }),
}));

import { runLLMStream } from "../streaming";
import {
  DOCUMENT_MUTATING_TOOL_NAMES,
  PROJECT_EXTRA_TOOLS,
} from "../tools/toolSchemas";

type RunToolsFn = (
  calls: { id: string; name: string; input: Record<string, unknown> }[],
) => Promise<{ tool_use_id: string; content: string }[]>;

// The mock stands in for llm.streamChatWithTools; declaring its parameter
// (rather than leaving the stub zero-arity) is what lets tsc check the
// `mock.calls[0][0]` lookups and the mockImplementation overrides below —
// with `vi.fn(async () => …)` the call tuple is empty and every assertion on
// it type-checks vacuously.
type StreamChatCall = {
  systemPrompt: string;
  messages: { role: string; content: string }[];
  tools: { function: { name: string } }[];
  maxIterations: number;
  runTools?: RunToolsFn;
  [key: string]: unknown;
};

function baseParams() {
  return {
    // #383 validates the requested model inside runLLMStream itself.
    model: "gemini-3-flash-preview",
    apiMessages: [{ role: "user", content: "hi" }],
    docStore: new Map(),
    docIndex: {},
    userId: "u1",
    db: {} as never,
    write: vi.fn(),
    extraTools: PROJECT_EXTRA_TOOLS,
  };
}

function advertisedToolNames(): string[] {
  const params = streamChatWithTools.mock.calls[0]?.[0] as {
    tools: { function: { name: string } }[];
  };
  return params.tools.map((tool) => tool.function.name);
}

const WRITERS = [
  "edit_document",
  "replicate_document",
  "finalize_document",
  "generate_docx",
  "generate_excel",
  "generate_ppt",
];

beforeEach(() => {
  vi.clearAllMocks();
  streamChatWithTools.mockResolvedValue({ fullText: "" });
});

describe("runLLMStream document-mutation gating", () => {
  it("treats an SDK-wrapped ask-input pause as a successful turn", async () => {
    const askInputsEvent = {
      type: "ask_inputs" as const,
      items: [
        {
          id: "choice-1",
          kind: "choice" as const,
          question: "Continue?",
          options: [{ value: "Yes" }],
          allow_other: false,
          other_label: "Other",
        },
      ],
    };
    runToolCalls.mockResolvedValueOnce({
      toolResults: [],
      docsRead: [],
      docsFound: [],
      docsCreated: [],
      docsReplicated: [],
      docsFinalized: [],
      workflowsApplied: [],
      docsEdited: [],
      askInputsEvents: [askInputsEvent],
      courtlistenerEvents: [],
      caseCitationEvents: [],
      auLegislationEvents: [],
      auEnergyEvents: [],
      auVicLegislationEvents: [],
      auCaseLawEvents: [],
      legislationCitationEvents: [],
      mcpEvents: [],
    } as never);
    streamChatWithTools.mockImplementationOnce(
      async (params: { runTools?: RunToolsFn }) => {
        try {
          await params.runTools?.([
            { id: "call-a", name: "ask_inputs", input: {} },
          ]);
        } catch (error) {
          // AI SDK reports a rejected tool execution as a fresh stream error.
          throw new Error(error instanceof Error ? error.message : "wrapped");
        }
        return { fullText: "" };
      },
    );

    const result = await runLLMStream(baseParams());

    expect(result.events).toEqual([askInputsEvent]);
    expect(result.events).not.toContainEqual(
      expect.objectContaining({ type: "error" }),
    );
  });

  it("advertises the writers by default", async () => {
    await runLLMStream(baseParams());
    const names = advertisedToolNames();
    for (const writer of WRITERS) expect(names).toContain(writer);
  });

  it("withholds every writer when document mutation is not allowed", async () => {
    await runLLMStream({ ...baseParams(), allowDocumentMutation: false });
    const names = advertisedToolNames();
    for (const writer of WRITERS) expect(names).not.toContain(writer);
  });

  it("keeps the whole reading surface for a read-only caller", async () => {
    await runLLMStream({ ...baseParams(), allowDocumentMutation: false });
    const names = advertisedToolNames();
    // Losing the writers must not cost a collaborator the conversation:
    // they can still read the project, search it, and be asked questions.
    for (const reader of [
      "read_document",
      "find_in_document",
      "ask_inputs",
      "list_documents",
      "fetch_documents",
      "list_workflows",
      "search_library",
    ]) {
      expect(names).toContain(reader);
    }
    expect(DOCUMENT_MUTATING_TOOL_NAMES.has("search_library")).toBe(false);
  });

  it("refuses a writing call the model asks for anyway, and never dispatches it", async () => {
    let toolResults: { tool_use_id: string; content: string }[] | undefined;
    streamChatWithTools.mockImplementation(
      async (params: { runTools?: RunToolsFn }) => {
        toolResults = await params.runTools?.([
          { id: "call-a", name: "edit_document", input: { doc_id: "doc-0" } },
          { id: "call-b", name: "read_document", input: { doc_id: "doc-0" } },
        ]);
        return { fullText: "" };
      },
    );

    await runLLMStream({ ...baseParams(), allowDocumentMutation: false });

    // Hiding the schema is not enough — a model can name a tool from memory,
    // so the call is dropped before it reaches the dispatcher.
    const dispatched = runToolCalls.mock.calls[0]![0].map(
      (call) => call.function.name,
    );
    expect(dispatched).toEqual(["read_document"]);
    expect(toolResults?.[0]).toEqual({
      tool_use_id: "call-a",
      content: JSON.stringify({
        error: "Tool 'edit_document' is not available.",
      }),
    });
  });

  it("dispatches a writing call normally when mutation is allowed", async () => {
    streamChatWithTools.mockImplementation(
      async (params: { runTools?: RunToolsFn }) => {
        await params.runTools?.([
          { id: "call-a", name: "edit_document", input: { doc_id: "doc-0" } },
        ]);
        return { fullText: "" };
      },
    );

    await runLLMStream(baseParams());

    const dispatched = runToolCalls.mock.calls[0]![0].map(
      (call) => call.function.name,
    );
    expect(dispatched).toEqual(["edit_document"]);
  });
});

describe("runLLMStream research-tool gating", () => {
  it("advertises US tools by default and withholds AU tools", async () => {
    await runLLMStream(baseParams());
    const names = advertisedToolNames();
    expect(names).toContain("courtlistener_verify_citations");
    expect(names).not.toContain("au_search_legislation");
  });

  it("withholds US tools when includeUsResearchTools is false", async () => {
    await runLLMStream({
      ...baseParams(),
      includeUsResearchTools: false,
    });
    const names = advertisedToolNames();
    expect(names).not.toContain("courtlistener_verify_citations");
    expect(names).not.toContain("au_search_legislation");
  });

  it("advertises AU tools only when includeAuResearchTools is true", async () => {
    await runLLMStream({
      ...baseParams(),
      includeUsResearchTools: false,
      includeAuResearchTools: true,
    });
    const names = advertisedToolNames();
    expect(names).not.toContain("courtlistener_verify_citations");
    expect(names).toContain("au_search_legislation");
    expect(names).toContain("au_get_legislation");
    expect(names).toContain("au_get_legislation_as_at");
    expect(names).toContain("au_legislation_versions");
    expect(names).toContain("au_find_in_legislation");
    expect(names).not.toContain("au_search_energy");
  });

  it("can advertise both research surfaces independently", async () => {
    await runLLMStream({
      ...baseParams(),
      includeUsResearchTools: true,
      includeAuResearchTools: true,
    });
    const names = advertisedToolNames();
    expect(names).toContain("courtlistener_verify_citations");
    expect(names).toContain("au_search_legislation");
    expect(names).not.toContain("au_search_energy");
  });

  it("advertises AU energy tools only when includeAuEnergyResearchTools is true", async () => {
    await runLLMStream({
      ...baseParams(),
      includeUsResearchTools: false,
      includeAuResearchTools: false,
      includeAuEnergyResearchTools: true,
    });
    const names = advertisedToolNames();
    expect(names).not.toContain("courtlistener_verify_citations");
    expect(names).not.toContain("au_search_legislation");
    expect(names).toContain("au_search_energy");
    expect(names).toContain("au_get_energy");
    expect(names).toContain("au_get_energy_as_at");
    expect(names).toContain("au_energy_versions");
    expect(names).toContain("au_find_in_energy");
  });

  it("advertises Victorian legislation tools only when includeAuVicResearchTools is true", async () => {
    await runLLMStream({
      ...baseParams(),
      includeUsResearchTools: false,
      includeAuResearchTools: false,
      includeAuEnergyResearchTools: false,
      includeAuVicResearchTools: true,
    });
    const names = advertisedToolNames();
    expect(names).not.toContain("au_search_legislation");
    expect(names).not.toContain("au_search_energy");
    expect(names).toContain("au_search_vic_legislation");
    expect(names).toContain("au_get_vic_legislation");
    expect(names).toContain("au_get_vic_legislation_as_at");
    expect(names).toContain("au_vic_legislation_versions");
    expect(names).toContain("au_find_in_vic_legislation");
  });

  it("advertises Australian case-law tools only when includeAuCasesResearchTools is true", async () => {
    await runLLMStream({
      ...baseParams(),
      includeUsResearchTools: false,
      includeAuResearchTools: false,
      includeAuCasesResearchTools: true,
    });
    const names = advertisedToolNames();
    expect(names).not.toContain("courtlistener_verify_citations");
    expect(names).toContain("au_search_case_law");
    expect(names).toContain("au_get_case");
    expect(names).toContain("au_find_in_case");
  });
});
