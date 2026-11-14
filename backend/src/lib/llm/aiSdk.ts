import { installProviderWarningLogger } from "./warnings";
import { normalizeReasoningLevelForModel } from "./models";
import type { LanguageModel, LanguageModelMiddleware, ToolSet } from "ai" with {
  "resolution-mode": "import",
};
import type * as AiSdk from "ai" with { "resolution-mode": "import" };
import type {
  LlmMessage,
  NormalizedToolCall,
  NormalizedToolResult,
  OpenAIToolSchema,
  Provider,
  ReasoningLevel,
  ProviderWebSearchEvent,
  StreamChatParams,
  StreamChatResult,
} from "./types";
import type { WebSource } from "@mike/contracts";
import { providerDeadlines } from "./providerDeadlines";
import {
  asProviderStallError,
  isDeterministicProviderQuota,
  streamErrorMessage,
  toProviderStreamError,
  withKeySource,
  type ProviderKeySource,
} from "./providerErrors";
import { createRawLlmStreamRecorder, logRawLlmStream } from "./rawStreamLog";

installProviderWarningLogger();

/**
 * Output budget when an adapter does not declare its own. Reasoning tokens
 * count against this on every provider, so it must leave room for a long
 * think plus the tool call or answer that follows it.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;
/** Hosted frontier models accept far more; give thinking room to finish. */
export const HOSTED_MAX_OUTPUT_TOKENS = 32_768;

/**
 * How many times one turn may recover from a step that spent its whole
 * output budget thinking and produced neither text nor a tool call.
 */
export const MAX_REASONING_OVERRUN_RETRIES = 2;

export const REASONING_OVERRUN_NUDGE = `Your previous attempt ran out of output room while thinking and produced nothing the user can see. Do not re-plan or re-read. Take the next concrete action now: either call one tool, or write the user-facing answer from what is already in this conversation.`;

export function isTruncatedToolInputError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  return /Invalid input for tool|JSON parsing failed|malformed JSON arguments/i.test(
    message,
  );
}

export function truncatedToolName(error: unknown): string | null {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const match =
    /Invalid input for tool ([A-Za-z0-9_]+)/.exec(message) ??
    /malformed JSON arguments for tool "([^"]+)"/.exec(message);
  return match?.[1] ?? null;
}

export function truncatedToolNudge(toolName: string | null): string {
  if (toolName === "create_plan" || toolName === "update_plan") {
    return `Your previous ${toolName} call was cut off before its arguments finished. Call ${toolName} now. Use a short title and at most 8 items. Each item must be one short sentence. Do not think at length first.`;
  }
  return `Your previous tool call was cut off before its arguments finished. Call one tool again with short arguments, or write the user-facing answer from what is already in this conversation. Do not think at length first.`;
}

const REASONING_STEP_DOWN: Partial<Record<ReasoningLevel, ReasoningLevel>> = {
  max: "xhigh",
  xhigh: "high",
  high: "medium",
  medium: "low",
  low: "low",
};

/** One notch less thinking for the retry after an overrun; "none" stays put. */
export function lowerReasoningLevel(
  level: ReasoningLevel | undefined,
): ReasoningLevel | undefined {
  if (!level) return level;
  return REASONING_STEP_DOWN[level] ?? level;
}

export type FinishedStepShape = {
  finishReason: string | undefined;
  producedText: boolean;
  producedToolCall: boolean;
};

/** A step that hit the output cap with nothing to show is a thinking overrun. */
export function isReasoningOverrunStep(
  step: FinishedStepShape | null,
): boolean {
  return (
    step !== null &&
    step.finishReason === "length" &&
    !step.producedText &&
    !step.producedToolCall
  );
}

type ModelMessageLike = AiSdk.ModelMessage;

/**
 * Assistant messages that carry nothing (the overrun step itself) would be
 * rejected by Anthropic as empty content; drop them before the retry.
 */
export function messagesForOverrunRetry(
  original: ModelMessageLike[],
  responseMessages: ModelMessageLike[],
  nudge: string = REASONING_OVERRUN_NUDGE,
): ModelMessageLike[] {
  const kept = responseMessages.filter((message) => {
    if (message.role !== "assistant") return true;
    if (typeof message.content === "string")
      return message.content.trim() !== "";
    return Array.isArray(message.content) && message.content.length > 0;
  });
  return [...original, ...kept, { role: "user", content: nudge }];
}

/** Ensure a proxy-closed final SSE event is still visible to SDK parsers. */

/** Keep SDK retry backoff for throttling, but don't repeat a proven account refusal. */
function quotaRefusalRetries(): LanguageModelMiddleware {
  const attempt = async <T>(call: () => PromiseLike<T>): Promise<T> => {
    try { return await call(); }
    catch (error) {
      if (isDeterministicProviderQuota(error) && error instanceof Error) {
        // APICallError exposes this flag to the SDK retry loop. Preserve the
        // actual exception, provider response, stack and cause for its owner.
        Object.defineProperty(error, "isRetryable", { value: false, configurable: true });
      }
      throw error;
    }
  };
  return {
    wrapGenerate: ({ doGenerate }) => attempt(doGenerate),
    wrapStream: ({ doStream }) => attempt(doStream),
  };
}

/**
 * Per-step output limit, or undefined to leave it to the provider.
 *
 * Unset by default: each provider applies its own model-aware ceiling
 * (`@ai-sdk/anthropic` fills in the model's maximum for the required
 * `max_tokens`), which a single shared number cannot track. Operators who want
 * a backstop set `LLM_MAX_OUTPUT_TOKENS`; an unusable value is ignored rather
 * than sent upstream.
 *
 * OpenCode Go keeps the previous 16,384: its Messages models (MiniMax, Qwen)
 * go through the Anthropic adapter, which does not recognise them and would
 * otherwise fall back to 4,096.
 *
 * `adapterDefault` is an adapter's own model-aware ceiling for SDKs that do
 * not fill one in (Bedrock sends no maxTokens unless given one, so Bedrock's
 * small server default would apply); see AiSdkAdapterConfig.
 */
export function maxOutputTokensFor(
  provider: Provider,
  adapterDefault?: number,
): number | undefined {
  const value = Number(process.env.LLM_MAX_OUTPUT_TOKENS);
  if (Number.isSafeInteger(value) && value > 0) return value;
  return provider === "opencode-go" ? 16_384 : adapterDefault;
}

/**
 * Tool-call rounds allowed per turn before `stopWhen` halts the run.
 *
 * 16, matching what the Word pane already passes. Document-heavy turns spend
 * several rounds just reading before any real work starts, and when this cap
 * fires the run simply ends — no error, no partial answer — so a value that is
 * merely "usually enough" fails invisibly. Callers may still override it.
 */
export const DEFAULT_MAX_ITERATIONS = 16;

/**
 * User-facing explanation for a turn that ended without finishing, or "" when
 * it ended normally.
 *
 * Exported for tests: the conditions are easy to get subtly wrong, and wrong
 * here means either a spurious warning under every good answer or silence
 * under every bad one.
 */
export function stopNotice(
  iterations: number,
  maxIterations: number,
  finishReason: string | undefined,
  rawFinishReason?: string,
): string {
  // Anthropic pauses a turn whose server-side tools (web search) ran long and
  // reports it as an ordinary "stop".
  if (rawFinishReason === "pause_turn") {
    return "\n\n_Stopped early: the web search for this response ran long. Ask a narrower question to get an answer._";
  }
  if (finishReason === "length") {
    return "\n\n_Stopped early: this response reached the model's output limit. Asking for one part at a time will get the rest._";
  }
  // Reaching the last round while still asking for tools means the model was
  // mid-work when stopWhen cut it off. Reaching it on "stop" means it had
  // finished and the round count is a coincidence, so say nothing.
  if (iterations >= maxIterations && finishReason !== "stop") {
    return `\n\n_Stopped after ${maxIterations} tool-call rounds without finishing. This is a step limit, not a length limit — narrowing the request, or pointing at fewer documents, usually resolves it._`;
  }
  return "";
}

/**
 * Ensure a proxy-closed final SSE event is still visible to SDK parsers.
 * `baseFetch` replaces the global fetch for endpoints that need guarded
 * egress (a user-supplied base URL).
 */
export async function aiSdkFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  baseFetch?: typeof fetch,
): Promise<Response> {
  const response = await (baseFetch ?? fetch)(input, init);
  if (
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  ) {
    return response;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const partials = new Map<number, { name: string; arguments: string }>();

  const validateToolCalls = (endedCleanly: boolean) => {
    for (const partial of partials.values()) {
      if (!partial.arguments) {
        if (!endedCleanly) {
          throw new Error(
            `LLM stream ended before any arguments arrived for tool "${partial.name}".`,
          );
        }
        continue;
      }
      try {
        JSON.parse(partial.arguments);
      } catch {
        // A clean terminal event proves that the transport delivered the
        // complete provider response. Preserve malformed arguments exactly as
        // sent so AI SDK can emit its recoverable dynamic tool-error instead
        // of preempting its tool-validation path. A stream that just closes is
        // still unsafe: its partial arguments must fail before any tool could
        // run.
        if (!endedCleanly) {
          throw new Error(
            `LLM stream ended with malformed JSON arguments for tool "${partial.name}".`,
          );
        }
      }
      if (!endedCleanly) {
        throw new Error(
          `LLM stream ended before a clean terminal event for tool "${partial.name}".`,
        );
      }
    }
    partials.clear();
  };

  const inspectLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      validateToolCalls(true);
      return;
    }
    if (!data) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    const choice = (
      event.choices as
        | Array<{
            delta?: { tool_calls?: Array<Record<string, unknown>> };
            finish_reason?: unknown;
          }>
        | undefined
    )?.[0];
    for (const toolCall of choice?.delta?.tool_calls ?? []) {
      const index = typeof toolCall.index === "number" ? toolCall.index : 0;
      const current = partials.get(index) ?? { name: "tool", arguments: "" };
      const fn = toolCall.function as Record<string, unknown> | undefined;
      if (typeof fn?.name === "string") current.name = fn.name;
      if (typeof fn?.arguments === "string") {
        current.arguments += fn.arguments;
      }
      partials.set(index, current);
    }
    if (choice?.finish_reason === "tool_calls") validateToolCalls(true);
  };

  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          inspectLine(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
        }
        controller.enqueue(chunk);
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer.trim()) inspectLine(buffer);
        if (partials.size) validateToolCalls(false);
        controller.enqueue(new Uint8Array([10, 10]));
      },
    }),
  );
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

const COURTLISTENER_CITATION_REMINDER_TOOL_NAMES = new Set([
  "courtlistener_find_in_case",
  "courtlistener_read_case",
]);

const COURTLISTENER_CITATION_REMINDER = `COURTLISTENER CITATION REMINDER:
If your final answer relies on any CourtListener case, every such case reference must have BOTH a clickable markdown case link and an inline [N] marker.
Include the clickable case link only the first time you cite that case; later references to the same case should reuse the existing inline [N] marker without repeating the link unless clarity requires it.
Assign new refs in first-use order as much as possible: [1], then [2], then [3]. Reuse an existing ref when citing the same case/passage again, even if that means a later sentence cites [3] and then [1] again.
End the response with a <CITATIONS> block containing one matching case entry per [N] marker:
{"ref": N, "cluster_id": 123, "quotes": [{"opinion_id": 456, "quote": "exact verbatim opinion text"}]}.
Do not use doc_id, page, top-level quote, case_name, or citation fields for CourtListener case entries.`;

export type AiSdkAdapterConfig = {
  provider: Provider;
  label: string;
  model: Exclude<LanguageModel, string>;
  modelId: string;
  /**
   * Whose key this adapter sends: a user's own, or the deployment's
   * environment key. Recorded on a failure so a refusal of the operator's
   * key is reported and a user's is not (providerFailureLevel).
   */
  keySource?: ProviderKeySource;
  /** Some protocol-compatible gateways reject reasoning request fields. */
  supportsReasoning?: boolean;
  /** OpenAI's CourtListener tools require an extra instruction after use. */
  courtlistenerCitationReminder?: boolean;
  /** Output-token cap for this adapter when the provider sends none. */
  maxOutputTokens?: number;
    /** The provider's own web search tool. */
  webSearchTool?: (options: { maxUses: number }) => ToolSet[string];
  /** Send stored reasoning on earlier assistant turns; see ConfiguredModel. */
  replayReasoning?: boolean;
  /** Mark the prefix-cache breakpoint with a Bedrock cache point as well. */
  bedrockCachePoint?: boolean;
  /**
   * Output ceiling for a chat step at the given reasoning level, for SDKs
   * that send none by default. LLM_MAX_OUTPUT_TOKENS still wins.
   */
  defaultMaxOutputTokens?: (
    reasoning: StreamChatParams["reasoning"],
  ) => number | undefined;
};

type PendingToolExecution = {
  call: NormalizedToolCall;
  resolve: (content: string) => void;
  reject: (error: unknown) => void;
};

/**
 * AI SDK executes all tool calls from a step concurrently. Collect those
 * same-tick executions so the existing provider-neutral runTools contract
 * still receives one batch per model step.
 */
class ToolExecutionBatcher {
  private pending: PendingToolExecution[] = [];
  private scheduled = false;

  constructor(
    private readonly runTools: NonNullable<StreamChatParams["runTools"]>,
    /** Fired synchronously when runTools rejects, before the SDK learns of it. */
    private readonly onFailure?: (error: unknown) => void,
  ) {}

  execute(call: NormalizedToolCall): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pending.push({ call, resolve, reject });
      if (!this.scheduled) {
        this.scheduled = true;
        queueMicrotask(() => void this.flush());
      }
    });
  }

  private async flush(): Promise<void> {
    const pending = this.pending;
    this.pending = [];
    this.scheduled = false;

    try {
      const results = await this.runTools(pending.map(({ call }) => call));
      const byId = new Map(
        results.map((result: NormalizedToolResult) => [
          result.tool_use_id,
          result.content,
        ]),
      );
      for (const item of pending) {
        const content = byId.get(item.call.id);
        if (content === undefined) {
          const error = new Error(
            `Tool ${item.call.name} returned no result for call ${item.call.id}.`,
          );
          this.onFailure?.(error);
          item.reject(error);
        } else {
          item.resolve(content);
        }
      }
    } catch (error) {
      this.onFailure?.(error);
      for (const item of pending) item.reject(error);
    }
  }
}

function normalizeToolInput(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function toAiSdkTools(
  schemas: OpenAIToolSchema[],
  runTools?: StreamChatParams["runTools"],
  sdk?: Pick<typeof AiSdk, "jsonSchema" | "tool">,
  onRunToolsFailure?: (error: unknown) => void,
): ToolSet | undefined {
  if (!schemas.length) return undefined;
  if (!sdk) throw new Error("AI SDK tool helpers are unavailable.");
  const batcher = runTools
    ? new ToolExecutionBatcher(runTools, onRunToolsFailure)
    : null;

  return Object.fromEntries(
    schemas.map((schema) => {
      const definition = {
        description: schema.function.description,
        inputSchema: sdk.jsonSchema<Record<string, unknown>>(
          schema.function.parameters as never,
        ),
        ...(batcher
          ? {
              execute: (
                input: Record<string, unknown>,
                { toolCallId }: { toolCallId: string },
              ) =>
                batcher.execute({
                  id: toolCallId,
                  name: schema.function.name,
                  input: normalizeToolInput(input),
                }),
            }
          : {}),
      };
      return [schema.function.name, sdk.tool(definition as never)];
    }),
  );
}

/**
 * The ORIGINAL Error instance from a `tool-error` / `error` part. Re-wrapping
 * it discards error identity, including control-flow and user-facing error
 * types thrown inside runTools (the SDK's tool `execute`).
 */
function rethrowable(error: unknown, label: string): Error {
  return error instanceof Error ? error : new Error(streamErrorMessage(error, label));
}

export const PROVIDER_WEB_SEARCH_TOOL = "web_search";

function webSourcesFrom(output: unknown): WebSource[] {
  // Anthropic returns the result list itself; OpenAI returns an action with
  // the sources it read.
  const items = Array.isArray(output)
    ? output
    : (output as { sources?: unknown } | null)?.sources;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    const { url, title } = (item ?? {}) as { url?: unknown; title?: unknown };
    if (typeof url !== "string") return [];
    return [{ url, ...(typeof title === "string" ? { title } : {}) }];
  });
}

/**
 * What a search looked for. OpenAI also reports opening or searching within
 * a page as a web search call; those are labelled with the page.
 */
function webSearchQueryFrom(input: unknown, output?: unknown): string | undefined {
  const action = (output as {
    action?: { query?: unknown; queries?: unknown; url?: unknown };
  } | null)?.action;
  const candidates = [
    (input as { query?: unknown } | null)?.query,
    action?.query,
    Array.isArray(action?.queries) ? action.queries.join(", ") : undefined,
    action?.url,
  ];
  return candidates.find(
    (value): value is string => typeof value === "string" && value !== "",
  );
}

function usesCourtlistenerTool(
  steps: Array<{ toolCalls: Array<{ toolName: string }> }>,
) {
  return steps.some((step) =>
    step.toolCalls.some((call) =>
      COURTLISTENER_CITATION_REMINDER_TOOL_NAMES.has(call.toolName),
    ),
  );
}

/**
 * Provider-specific hints that let a multi-turn conversation reuse the
 * already-processed prompt prefix instead of paying for it on every turn.
 *
 * OpenAI caches automatically but routes by `prompt_cache_key`; sending the
 * conversation id keeps consecutive turns on the same cache. Anthropic only
 * caches up to an explicit breakpoint, so the last message gets one: it
 * covers the system prompt, tool definitions, and every earlier turn, and
 * the next request hits that prefix as long as it is byte-identical.
 * Providers ignore namespaces they do not own, so both hints are sent.
 * Azure OpenAI reads the OpenAI hint from its own `azure` namespace. Bedrock
 * caches at an explicit cache point too, but most Bedrock models reject one,
 * so that marker is added only when the adapter asks for it.
 */
type StreamTextProviderOptions = NonNullable<
  Parameters<typeof AiSdk.streamText>[0]["providerOptions"]
>;

/**
 * An earlier assistant turn's reasoning becomes a reasoning part ahead of its
 * text, which the OpenAI-compatible adapter sends as `reasoning_content`.
 * Without `replay` the stored reasoning is dropped, so no other provider ever
 * receives it.
 */
function toModelMessage(
  message: LlmMessage,
  replay: boolean,
): AiSdk.UserModelMessage | AiSdk.AssistantModelMessage {
  if (message.role === "user") {
    return { role: "user", content: message.content };
  }
  if (!replay || !message.reasoning) {
    return { role: "assistant", content: message.content };
  }
  return {
    role: "assistant",
    content: [
      { type: "reasoning", text: message.reasoning },
      { type: "text", text: message.content },
    ],
  };
}

export const LAST_STEP_WRITE_REMINDER = `LAST STEP: Do not call any tools. Write the user-facing answer now from the documents and notes already in this response. If you cannot finish every attachment or edit, write what you have and state what remains.`;

/** Research steps already taken before the next step must be the answer. */
export const RESEARCH_ROUNDS_BEFORE_WRITE = 4;

const WRITE_FROM_RESEARCH_NUDGE = `Write the user-facing answer now from the documents and notes already in this conversation. Do not call tools. Do not start the research again. If something is still unread, say what remains.`;

export const PLAN_NOW_REMINDER = `PLAN NOW: Call create_plan. Name the parts of the response, including what you still need to read. Each item is one short sentence. Do not review, explain, draft, or answer the substance in this response.`;

export const PLAN_COMPLETE_SUMMARY = `PLAN COMPLETE: The plan has no remaining steps. Do not call any tools. Write a short summary of what was actually produced for the user. Name the documents, edits, and notes that exist in this conversation. If a step was marked done but the document, edit, or note was not produced, say so and include the text now. Do not claim something was drafted, filed, or placed in Outlook unless that happened in this conversation.`;

export type StreamStepState = {
  toolCalls: Array<{ toolName: string }>;
};

function isResearchToolName(name: string): boolean {
  return name.startsWith("au_") || name.startsWith("courtlistener_");
}

function researchRoundCount(steps: StreamStepState[]): number {
  let count = 0;
  for (const step of steps) {
    if (step.toolCalls.some((call) => isResearchToolName(call.toolName))) {
      count += 1;
    }
  }
  return count;
}

export type PreparedStreamStep = {
  system?: string;
  activeTools?: string[];
  toolChoice?: "none" | "required" | { type: "tool"; toolName: "create_plan" };
};

export function prepareAssistantStreamStep(args: {
  steps: StreamStepState[];
  maxIterations: number;
  systemPrompt: string;
  courtlistenerReminder?: boolean;
  requirePlan?: boolean;
  planSummaryNow?: { current: boolean };
}): PreparedStreamStep | undefined {
  const maxIterations = Math.max(1, args.maxIterations);
  const lastStep = args.steps.length >= maxIterations - 1;
  if (args.planSummaryNow?.current) {
    return {
      activeTools: [],
      toolChoice: "none",
      system: `${args.systemPrompt}\n\n${PLAN_COMPLETE_SUMMARY}`,
    };
  }
  const requirePlan = args.requirePlan === true;
  // After one look, or immediately when this is the only step, the turn
  // names its work and stops. It does not become the written answer.
  const forcePlan = requirePlan && (args.steps.length >= 1 || lastStep);
  const requireTool = requirePlan && !forcePlan;
  // A research question was spending every remaining round on another
  // fetch, so the reserved writing step arrived with nothing to say.
  const forceWrite =
    !requirePlan &&
    (lastStep || researchRoundCount(args.steps) >= RESEARCH_ROUNDS_BEFORE_WRITE);
  const courtlistener =
    !forcePlan &&
    !forceWrite &&
    args.courtlistenerReminder === true &&
    usesCourtlistenerTool(args.steps);
  if (!forceWrite && !courtlistener && !forcePlan && !requireTool) {
    return undefined;
  }
  if (forcePlan) {
    return {
      activeTools: ["create_plan"],
      toolChoice: { type: "tool", toolName: "create_plan" },
      system: `${args.systemPrompt}\n\n${PLAN_NOW_REMINDER}`,
    };
  }
  if (requireTool) {
    return { toolChoice: "required" };
  }
  const extras = [
    courtlistener ? COURTLISTENER_CITATION_REMINDER : "",
    forceWrite ? LAST_STEP_WRITE_REMINDER : "",
  ].filter(Boolean);
  return {
    ...(forceWrite
      ? { activeTools: [] as [], toolChoice: "none" as const }
      : {}),
    system: extras.length
      ? `${args.systemPrompt}\n\n${extras.join("\n\n")}`
      : args.systemPrompt,
  };
}

export function withPrefixCacheHints(
  params: StreamChatParams,
  options: { replayReasoning?: boolean; bedrockCachePoint?: boolean } = {},
): {
  messages: AiSdk.ModelMessage[];
  providerOptions?: StreamTextProviderOptions;
} {
  const messages: (AiSdk.UserModelMessage | AiSdk.AssistantModelMessage)[] =
    params.messages.some((m) => m.reasoning !== undefined)
      ? params.messages.map((m) =>
          toModelMessage(m, options.replayReasoning === true),
        )
      : params.messages;
  if (!params.conversationId || !messages.length) {
    return { messages };
  }
  const last = messages.length - 1;
  const breakpoint = {
    anthropic: { cacheControl: { type: "ephemeral" } },
    ...(options.bedrockCachePoint
      ? { bedrock: { cachePoint: { type: "default" } } }
      : {}),
  };
  return {
    messages: messages.map((message, index): AiSdk.ModelMessage => {
      if (index !== last) return message;
      return message.role === "assistant"
        ? { role: "assistant", content: message.content, providerOptions: breakpoint }
        : { role: "user", content: message.content, providerOptions: breakpoint };
    }),
    providerOptions: {
      openai: { promptCacheKey: params.conversationId },
      azure: { promptCacheKey: params.conversationId },
    },
  };
}

export async function streamAiSdk(
  params: StreamChatParams,
  config: AiSdkAdapterConfig,
): Promise<StreamChatResult> {
  const sdk = await import("ai");
  // Internal abort linked to the caller's signal: a runTools failure (e.g. the
  // ask_inputs pause) ends the turn, but the SDK's step loop would fire the
  // NEXT model request before this consumer sees the `tool-error` part — so
  // abort synchronously in the batcher's failure path and keep that first
  // failure (the stream may surface an `abort` part before the `tool-error`).
  const internalAbort = new AbortController();
  const forwardAbort = () => internalAbort.abort(params.abortSignal?.reason);
  if (params.abortSignal?.aborted) forwardAbort();
  else params.abortSignal?.addEventListener("abort", forwardAbort, { once: true });
  const runToolsFailure: { first: { error: unknown } | null } = { first: null };
  const functionTools = toAiSdkTools(params.tools ?? [], params.runTools, sdk, (error) => {
    runToolsFailure.first ??= { error };
    internalAbort.abort();
  });
  const webSearch =
    params.providerWebSearch && config.webSearchTool
      ? {
          tool: config.webSearchTool({
            maxUses: params.providerWebSearch.maxSearches,
          }),
        }
      : null;
  const tools = webSearch
    ? { ...functionTools, [PROVIDER_WEB_SEARCH_TOOL]: webSearch.tool }
    : functionTools;
  const emitWebSearch = (event: ProviderWebSearchEvent) =>
    params.callbacks?.onWebSearch?.(event);
  // An exception that merely LOOKS like an abort (name "AbortError" or
  // isAbortError's exact message) must not take streaming.ts's silent
  // user-cancel path unless the caller's signal really is aborted.
  const guardAbortShaped = (e: Error): Error =>
    params.abortSignal?.aborted ||
    (e.name !== "AbortError" && e.message !== "Stream aborted.")
      ? e
      : new Error(
          e.message === "Stream aborted."
            ? "Stream aborted. (no abort was requested; treated as an error)"
            : e.message,
          { cause: e },
        );
  const cacheHints = withPrefixCacheHints(params, {
    replayReasoning: config.replayReasoning,
    bedrockCachePoint: config.bedrockCachePoint,
  });
  const providerOptions: StreamTextProviderOptions = {
    ...(cacheHints.providerOptions ?? {}),
    ...(config.provider === "openrouter"
      ? {
          // OpenRouter's adapter does not consume AI SDK's call-level
          // `reasoning` option. Its per-request namespace is merged into the
          // outbound body, so mirror the selected level there as well.
          openrouter: {
            reasoning: { effort: params.reasoning ?? "none" },
          },
        }
      : {}),
  };
  const rawStreamRecorder = createRawLlmStreamRecorder({
    provider: config.provider,
    model: config.modelId,
  });
  let fullText = "";
  let iteration = 0;
  const openReasoningBlocks = new Set<string>();
  const maxIterations = params.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  let lastFinishReason: string | undefined;
  let lastRawFinishReason: string | undefined;

  try {
    const result = sdk.streamText({
      model: sdk.wrapLanguageModel({
        model: config.model,
        middleware: [providerDeadlines(params.callbacks?.onActivity), quotaRefusalRetries()],
      }),
      system: params.systemPrompt,
      messages: cacheHints.messages,
      ...(Object.keys(providerOptions).length
        ? { providerOptions }
        : {}),
      tools,
      maxOutputTokens: maxOutputTokensFor(
        config.provider,
        config.maxOutputTokens ??
          config.defaultMaxOutputTokens?.(params.reasoning),
      ),
      stopWhen: sdk.stepCountIs(maxIterations),
      abortSignal: internalAbort.signal,
      reasoning:
        config.supportsReasoning === false
          ? undefined
          : // The OpenAI adapter and API support `max`, while AI SDK Core 7's
            // shared call-options type still omits it. Preserve the runtime
            // value across that temporary upstream type mismatch.
            ((params.reasoning ?? "none") as
              | "provider-default"
              | Exclude<NonNullable<StreamChatParams["reasoning"]>, "max">
              | undefined),
      include: { rawChunks: true },
      // Without an onError, streamText's default is `console.error(error)`:
      // the raw provider error is logged — and filed by the Sentry console
      // bridge — before the same failure reaches the "error" part below,
      // where it is classified and the caller reports it once
      // (MIKE-BACKEND-C). Every failure still arrives through fullStream.
      onError: () => {},
      prepareStep: ({
        steps,
        stepNumber,
      }: {
        steps: Array<{ toolCalls: Array<{ toolName: string }> }>;
        stepNumber: number;
      }) => {
        const prepared = prepareAssistantStreamStep({
          steps,
          maxIterations,
          systemPrompt: params.systemPrompt,
          courtlistenerReminder: config.courtlistenerCitationReminder,
          requirePlan: params.requirePlan,
          planSummaryNow: params.planSummaryNow,
        });
        const step: {
          system?: string;
          activeTools?: string[];
          toolChoice?:
            | "none"
            | "required"
            | { type: "tool"; toolName: "create_plan" };
        } = { ...(prepared ?? {}) };
        // Removing tools instead would break providers that reject a
        // history of calls to a tool the request no longer defines.
        if (
          params.finishWithoutToolsOnLastStep &&
          stepNumber === maxIterations - 1 &&
          step.toolChoice == null
        ) {
          step.toolChoice = "none";
        }
        return Object.keys(step).length ? step : undefined;
      },
    });

    for await (const part of result.stream) {
      switch (part.type) {
        case "start-step":
          iteration += 1;
          break;
        case "raw":
          logRawLlmStream({
            provider: config.provider,
            model: config.modelId,
            iteration: Math.max(0, iteration - 1),
            label: "ai_sdk_raw",
            payload: part.rawValue,
          });
          rawStreamRecorder?.record({
            iteration: Math.max(0, iteration - 1),
            label: "ai_sdk_raw",
            payload: part.rawValue,
          });
          break;
        case "text-delta":
          fullText += part.text;
          params.callbacks?.onContentDelta?.(part.text);
          break;
        case "reasoning-start":
          openReasoningBlocks.add(part.id);
          break;
        case "reasoning-delta":
          openReasoningBlocks.add(part.id);
          params.callbacks?.onReasoningDelta?.(part.text);
          break;
        case "reasoning-end":
          if (openReasoningBlocks.delete(part.id)) {
            params.callbacks?.onReasoningBlockEnd?.();
          }
          break;
        case "tool-call": {
          if (part.providerExecuted) {
            if (part.toolName === PROVIDER_WEB_SEARCH_TOOL) {
              emitWebSearch({
                kind: "search_started",
                id: part.toolCallId,
                query: webSearchQueryFrom(part.input),
              });
            }
            break;
          }
          const call: NormalizedToolCall = {
            id: part.toolCallId,
            name: part.toolName,
            input: normalizeToolInput(part.input),
            ...(part.invalid ? { invalid: true as const } : {}),
          };
          params.callbacks?.onToolCallStart?.(call);
          break;
        }
        case "tool-result":
          if (part.providerExecuted && part.toolName === PROVIDER_WEB_SEARCH_TOOL) {
            emitWebSearch({
              kind: "search_finished",
              id: part.toolCallId,
              query: webSearchQueryFrom(part.input, part.output),
              results: webSourcesFrom(part.output),
              failed: false,
            });
          }
          break;
        case "source":
          // Anthropic also reports every search result it was shown as a
          // source, marked by its page age; the ones it cites carry none.
          if (
            part.sourceType === "url" &&
            !(
              part.providerMetadata?.anthropic &&
              "pageAge" in part.providerMetadata.anthropic
            )
          ) {
            emitWebSearch({
              kind: "cited_source",
              source: {
                url: part.url,
                ...(part.title ? { title: part.title } : {}),
              },
            });
          }
          break;
        case "finish-step":
          if (
            part.usage.inputTokens !== undefined ||
            part.usage.outputTokens !== undefined
          ) {
            params.callbacks?.onUsage?.(
              {
                inputTokens: part.usage.inputTokens ?? 0,
                outputTokens: part.usage.outputTokens ?? 0,
              },
              part.finishReason,
            );
          }
          lastFinishReason = part.finishReason;
          lastRawFinishReason = part.rawFinishReason;
          break;
        // A tool's own failure is not the model provider's: a search tool
        // answering 401 says nothing about our LLM key, so this path keeps the
        // executor error rather than blaming the user's credentials.
        case "tool-error":
          // A failed provider-run search (rate limit, too many uses) is
          // reported to the model by the provider itself; the turn goes on.
          if (part.providerExecuted) {
            if (part.toolName === PROVIDER_WEB_SEARCH_TOOL) {
              emitWebSearch({
                kind: "search_finished",
                id: part.toolCallId,
                query: webSearchQueryFrom(part.input),
                results: [],
                failed: true,
              });
            }
            break;
          }
          // `dynamic: true` = the SDK synthesized this part for a call it could
          // not dispatch (unknown tool / unparseable input); it already queued
          // the error as that call's result and continues the loop so the
          // model can recover. Mike's tools are static, so only a genuine
          // execute() failure reaches the throw.
          if ((part as { dynamic?: boolean }).dynamic === true) break;
          runToolsFailure.first ??= { error: part.error };
          throw guardAbortShaped(rethrowable(part.error, config.label));
        case "error":
          throw guardAbortShaped(toProviderStreamError(part.error, config));
        case "abort": {
          const stalled = params.abortSignal?.aborted
            ? null
            : asProviderStallError(part.reason, config);
          if (stalled) throw stalled;
          const error = new Error(part.reason || "Stream aborted.");
          error.name = "AbortError";
          throw error;
        }
      }
    }

    for (const id of openReasoningBlocks) {
      openReasoningBlocks.delete(id);
      params.callbacks?.onReasoningBlockEnd?.();
    }
    // A run halted by stopWhen, or cut off at the output ceiling, otherwise
    // ends exactly like a finished one: streamText just stops and this
    // function returns whatever text happened to accumulate. That renders as
    // a bare "Completed in N steps" with no answer and no error, which is
    // indistinguishable from the model having nothing to say. Name it instead.
    const notice = stopNotice(
      iteration,
      maxIterations,
      lastFinishReason,
      lastRawFinishReason,
    );
    if (notice) {
      fullText += notice;
      if (params.callbacks?.onStopNotice) params.callbacks.onStopNotice(notice);
      else params.callbacks?.onContentDelta?.(notice);
    }
    await rawStreamRecorder?.flush("completed");
    return { fullText };
  } catch (error) {
    internalAbort.abort();
    // Only model-provider failures are eligible for API-key/quota guidance.
    // Tool failures (including pauses) retain their original identity.
    const fatal = runToolsFailure.first
      ? guardAbortShaped(rethrowable(runToolsFailure.first.error, config.label))
      : guardAbortShaped(toProviderStreamError(error, config));
    await rawStreamRecorder?.flush("error", fatal);
    throw fatal;
  } finally {
    params.abortSignal?.removeEventListener("abort", forwardAbort);
  }
}

export async function completeAiSdkText(
  params: {
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    abortSignal?: AbortSignal;
  },
  config: AiSdkAdapterConfig,
): Promise<string> {
  const { generateText, wrapLanguageModel } = await import("ai");
  const reasoning =
    config.supportsReasoning === false
      ? undefined
      : normalizeReasoningLevelForModel(config.modelId, "none");
  const requested = params.maxTokens ?? 512;
  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    result = await generateText({
      model: wrapLanguageModel({ model: config.model, middleware: quotaRefusalRetries() }),
      system: params.systemPrompt,
      prompt: params.user,
      abortSignal: params.abortSignal,
      // Some models cannot turn thinking off ("none" is normalized to the
      // lowest level they accept), and thinking is output too. Without
      // headroom a short call — a 64-token title — can spend its whole
      // allowance thinking and return no text. The cap is only a ceiling, so
      // the headroom costs nothing unless the model actually uses it.
      maxOutputTokens:
        reasoning && reasoning !== "none"
          ? requested + COMPLETION_REASONING_HEADROOM_TOKENS
          : requested,
      reasoning: reasoning as
        | Exclude<NonNullable<StreamChatParams["reasoning"]>, "max">
        | undefined,
    });
  } catch (error) {
    // The provider's own error, unconverted (callers classify it), with
    // whose key was sent recorded on it for the reporting level.
    throw withKeySource(error, config.keySource, config.provider);
  }
  return result.text;
}

/**
 * Extra output allowance for one-shot completions on models that always
 * reason (Opus 5.5, Fable 5.1, GPT-6 Astra/Sol 6.1 — directly, or through
 * Bedrock, Vertex, Foundry, Azure or a router). 4,096 matches what
 * @ai-sdk/amazon-bedrock adds on top of a thinking budget for the answer.
 */
export const COMPLETION_REASONING_HEADROOM_TOKENS = 4_096;
