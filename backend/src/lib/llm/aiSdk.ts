import type { LanguageModel, ToolSet } from "ai" with {
  "resolution-mode": "import",
};
import type * as AiSdk from "ai" with { "resolution-mode": "import" };
import {
  DEFAULT_STREAM_MAX_ITERATIONS,
  type NormalizedToolCall,
  type NormalizedToolResult,
  type OpenAIToolSchema,
  type Provider,
  type ReasoningLevel,
  type StreamChatParams,
  type StreamChatResult,
} from "./types";
import { createRawLlmStreamRecorder, logRawLlmStream } from "./rawStreamLog";

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
export function isReasoningOverrunStep(step: FinishedStepShape | null): boolean {
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
    if (typeof message.content === "string") return message.content.trim() !== "";
    return Array.isArray(message.content) && message.content.length > 0;
  });
  return [...original, ...kept, { role: "user", content: nudge }];
}

/** Ensure a proxy-closed final SSE event is still visible to SDK parsers. */
export async function aiSdkFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
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
        throw new Error(
          `LLM stream ended with malformed JSON arguments for tool "${partial.name}".`,
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
  model: LanguageModel;
  modelId: string;
  /** Some protocol-compatible gateways reject reasoning request fields. */
  supportsReasoning?: boolean;
  /** OpenAI's CourtListener tools require an extra instruction after use. */
  courtlistenerCitationReminder?: boolean;
  /** Output-token cap for this adapter; defaults to DEFAULT_MAX_OUTPUT_TOKENS. */
  maxOutputTokens?: number;
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
          item.reject(
            new Error(
              `Tool ${item.call.name} returned no result for call ${item.call.id}.`,
            ),
          );
        } else {
          item.resolve(content);
        }
      }
    } catch (error) {
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
): ToolSet | undefined {
  if (!schemas.length) return undefined;
  if (!sdk) throw new Error("AI SDK tool helpers are unavailable.");
  const batcher = runTools ? new ToolExecutionBatcher(runTools) : null;

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

function errorMessage(error: unknown, label: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return `${label} stream failed.`;
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

export const LAST_STEP_WRITE_REMINDER = `LAST STEP: Do not call any tools. Write the user-facing answer now from the documents and notes already in this response. If you cannot finish every attachment or edit, write what you have and state what remains.`;

export type StreamStepState = {
  toolCalls: Array<{ toolName: string }>;
};

export function prepareAssistantStreamStep(args: {
  steps: StreamStepState[];
  maxIterations: number;
  systemPrompt: string;
  courtlistenerReminder?: boolean;
}):
  | { system?: string; activeTools?: []; toolChoice?: "none" }
  | undefined {
  const maxIterations = Math.max(1, args.maxIterations);
  const lastStep = args.steps.length >= maxIterations - 1;
  const courtlistener =
    args.courtlistenerReminder === true && usesCourtlistenerTool(args.steps);
  if (!lastStep && !courtlistener) return undefined;
  const extras = [
    courtlistener ? COURTLISTENER_CITATION_REMINDER : "",
    lastStep ? LAST_STEP_WRITE_REMINDER : "",
  ].filter(Boolean);
  return {
    ...(lastStep ? { activeTools: [] as [], toolChoice: "none" as const } : {}),
    system: extras.length
      ? `${args.systemPrompt}\n\n${extras.join("\n\n")}`
      : args.systemPrompt,
  };
}

export async function streamAiSdk(
  params: StreamChatParams,
  config: AiSdkAdapterConfig,
): Promise<StreamChatResult> {
  const sdk = await import("ai");
  const tools = toAiSdkTools(params.tools ?? [], params.runTools, sdk);
  const rawStreamRecorder = createRawLlmStreamRecorder({
    provider: config.provider,
    model: config.modelId,
  });
  let fullText = "";
  let iteration = 0;
  const openReasoningBlocks = new Set<string>();

  const maxIterations = params.maxIterations ?? DEFAULT_STREAM_MAX_ITERATIONS;
  const maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

  // A thinking overrun ends the AI SDK loop with nothing to continue on. Each
  // retry replays this turn's own steps (tool calls and results included) and
  // asks for an action with a little less thinking, inside the same budget.
  let messages: ModelMessageLike[] = params.messages;
  let reasoning = params.reasoning;
  let remainingSteps = maxIterations;
  let overrunRetries = 0;

  try {
    for (;;) {
      let stepsThisRun = 0;
      let currentStep: FinishedStepShape = {
        finishReason: undefined,
        producedText: false,
        producedToolCall: false,
      };
      let lastFinishedStep: FinishedStepShape | null = null;

      const result = sdk.streamText({
        model: config.model,
        system: params.systemPrompt,
        messages,
        tools,
        maxOutputTokens,
        stopWhen: sdk.stepCountIs(remainingSteps),
        abortSignal: params.abortSignal,
        reasoning:
          config.supportsReasoning === false
            ? undefined
            : // The OpenAI adapter and API support `max`, while AI SDK Core 7's
              // shared call-options type still omits it. Preserve the runtime
              // value across that temporary upstream type mismatch.
              ((reasoning ?? "none") as
                | "provider-default"
                | Exclude<NonNullable<StreamChatParams["reasoning"]>, "max">
                | undefined),
        include: { rawChunks: true },
        prepareStep: ({
          steps,
        }: {
          steps: Array<{ toolCalls: Array<{ toolName: string }> }>;
        }) =>
          prepareAssistantStreamStep({
            steps,
            maxIterations: remainingSteps,
            systemPrompt: params.systemPrompt,
            courtlistenerReminder: config.courtlistenerCitationReminder,
          }),
      });

      let truncatedTool: string | null | undefined;
      try {
      for await (const part of result.stream) {
        switch (part.type) {
          case "start-step":
            iteration += 1;
            stepsThisRun += 1;
            currentStep = {
              finishReason: undefined,
              producedText: false,
              producedToolCall: false,
            };
            break;
          case "finish-step":
            currentStep.finishReason = part.finishReason;
            lastFinishedStep = currentStep;
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
            if (part.text) currentStep.producedText = true;
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
            currentStep.producedToolCall = true;
            const call: NormalizedToolCall = {
              id: part.toolCallId,
              name: part.toolName,
              input: normalizeToolInput(part.input),
            };
            params.callbacks?.onToolCallStart?.(call);
            break;
          }
          case "tool-error":
          case "error": {
            const streamError =
              part.error instanceof Error
                ? part.error
                : new Error(errorMessage(part.error, config.label));
            if (isTruncatedToolInputError(streamError)) {
              throw Object.assign(streamError, {
                truncatedToolInput: true,
              });
            }
            throw streamError;
          }
          case "abort": {
            const error = new Error(part.reason || "Stream aborted.");
            error.name = "AbortError";
            throw error;
          }
        }
      }
      } catch (error) {
        if (!isTruncatedToolInputError(error)) throw error;
        truncatedTool = truncatedToolName(error);
      }

      for (const id of openReasoningBlocks) {
        openReasoningBlocks.delete(id);
        params.callbacks?.onReasoningBlockEnd?.();
      }

      remainingSteps = Math.max(1, remainingSteps - stepsThisRun);
      const toolInputCutOff = truncatedTool !== undefined;
      const canRetry =
        (isReasoningOverrunStep(lastFinishedStep) || toolInputCutOff) &&
        overrunRetries < MAX_REASONING_OVERRUN_RETRIES &&
        !params.abortSignal?.aborted;
      if (!canRetry) {
        if (toolInputCutOff) {
          throw new Error(
            errorMessage(
              new Error(
                `Invalid input for tool ${truncatedTool ?? "tool"}: JSON parsing failed`,
              ),
              config.label,
            ),
          );
        }
        break;
      }

      overrunRetries += 1;
      let responseMessages: ModelMessageLike[] = [];
      try {
        responseMessages = (await result.responseMessages) as ModelMessageLike[];
      } catch {
        responseMessages = [];
      }
      messages = messagesForOverrunRetry(
        messages,
        responseMessages,
        toolInputCutOff ? truncatedToolNudge(truncatedTool) : REASONING_OVERRUN_NUDGE,
      );
      reasoning = lowerReasoningLevel(reasoning);
      console.warn("[llm-stream] reasoning overrun, retrying with less thinking", {
        provider: config.provider,
        model: config.modelId,
        attempt: overrunRetries,
        reasoning,
        remainingSteps,
        truncatedTool: toolInputCutOff ? truncatedTool : undefined,
      });
    }

    await rawStreamRecorder?.flush("completed");
    return { fullText };
  } catch (error) {
    await rawStreamRecorder?.flush("error", error);
    throw error;
  }
}

export async function completeAiSdkText(
  params: {
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
  },
  config: AiSdkAdapterConfig,
): Promise<string> {
  const { generateText } = await import("ai");
  const result = await generateText({
    model: config.model,
    system: params.systemPrompt,
    prompt: params.user,
    maxOutputTokens: params.maxTokens ?? 512,
    reasoning: config.supportsReasoning === false ? undefined : "none",
  });
  return result.text;
}
