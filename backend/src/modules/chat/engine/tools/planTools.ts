import type {
  AssistantEvent,
  PlanEvent,
  PlanItem,
  PlanItemStatus,
} from "@mike/contracts";
import { INCOMPLETE_TURN_MESSAGE } from "../incompleteTurn";

export const CREATE_PLAN_REQUIRED_ERROR =
  "Call create_plan with the remaining steps, then stop. Do not draft, copy, edit, or generate documents in this response.";

export const PLAN_SLICE_WRITE_REMINDER = `PLAN SLICE: Do not call any tools. Write a short progress note for the work just done. Do not start the next plan item.`;

export const PLAN_PAUSE_CONTENT =
  "I will work through this one step at a time.";

export const PLAN_CONTINUE_MESSAGE = "Continue with the next step.";

/** A first look, then create_plan. The server runs the remaining slices. */
export const PLAN_FIRST_MAX_ITERATIONS = 2;

/** Opening slice plus continuations. Past this, the run stops for Continue. */
export const PLAN_SLICE_CAP = 16;

/** Short questions below this length, with no documents, may answer directly. */
export const PLAN_WORD_THRESHOLD = 25;

const ATTACHMENT_MARKER = "[The user attached the following document(s)";

/** Continuation budget: enough to read and produce one slice, not a whole job. */
export const PLAN_SLICE_MAX_ITERATIONS = 8;

export const PLAN_FIRST_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
  "edit_document",
  "comment_document",
  "replicate_document",
  "finalize_document",
  "generate_docx",
  "generate_excel",
  "generate_ppt",
  "create_outlook_draft",
  "apply_word_edits",
  "comment_active_document",
  "comment_document",
]);

export const ACTIVE_PLAN_MARKER = "[Active plan]";

const PLAN_ITEM_STATUSES = new Set<PlanItemStatus>([
  "pending",
  "in_progress",
  "completed",
]);

function cleanPlanString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.replace(/\s+/g, " ").trim();
}

function normalizePlanStatus(
  value: unknown,
  fallback: PlanItemStatus,
): PlanItemStatus {
  return typeof value === "string" &&
    PLAN_ITEM_STATUSES.has(value as PlanItemStatus)
    ? (value as PlanItemStatus)
    : fallback;
}

export function planHasPendingItems(
  plan: Pick<PlanEvent, "items"> | null | undefined,
): boolean {
  return !!plan?.items.some((item) => item.status !== "completed");
}

export function lastUserHasWorkflow(
  messages: Array<{ role?: string; content?: string | null }>,
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    return /\[Workflow:/.test(message.content ?? "");
  }
  return false;
}

export function messagesHaveActivePlan(
  messages: Array<{ content?: string | null }>,
): boolean {
  return messages.some((message) =>
    (message.content ?? "").includes(ACTIVE_PLAN_MARKER),
  );
}

export type PlanTurnMessage = {
  role?: string;
  content?: string | null;
  files?: readonly unknown[] | null;
  workflow?: unknown;
};

function lastUserMessage(messages: PlanTurnMessage[]): PlanTurnMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "user") return message;
  }
  return null;
}

function wordCount(content: string): number {
  return content.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * The server decides this. A review is not optional. The model does not get
 * to treat one as a single step.
 */
export function turnRequiresPlan(
  messages: PlanTurnMessage[],
  options?: { hasDocuments?: boolean },
): boolean {
  if (messagesHaveActivePlan(messages)) return false;
  const last = lastUserMessage(messages);
  if (!last) return false;
  const content = (last.content ?? "").trim();
  if (content === PLAN_CONTINUE_MESSAGE) return false;
  if (last.workflow || lastUserHasWorkflow(messages)) return true;
  if ((last.files?.length ?? 0) > 0) return true;
  if (content.includes(ATTACHMENT_MARKER)) return true;
  if (options?.hasDocuments) return true;
  return wordCount(content) >= PLAN_WORD_THRESHOLD;
}

export function formatActivePlanBlock(plan: PlanEvent): string {
  const lines = [
    ACTIVE_PLAN_MARKER,
    `Title: ${plan.title}`,
    ...plan.items.map((item) => `- ${item.status}: ${item.content}`),
  ];
  if (planHasPendingItems(plan)) {
    lines.push(
      "Instruction: Execute only the next one or two pending items. Then call update_plan and stop. Do not finish the whole plan in this response.",
    );
  }
  return lines.join("\n");
}

export function parsePlanEvent(value: unknown): PlanEvent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.type !== "plan") return null;
  const eventId =
    typeof row.event_id === "string" && row.event_id.trim()
      ? row.event_id.trim()
      : "";
  const title = cleanPlanString(row.title, "Plan");
  const items = Array.isArray(row.items)
    ? row.items.flatMap((item, index) => {
        if (!item || typeof item !== "object") return [];
        const entry = item as Record<string, unknown>;
        const content = cleanPlanString(entry.content);
        if (!content) return [];
        const id =
          typeof entry.id === "string" && entry.id.trim()
            ? entry.id.trim().slice(0, 80)
            : `step-${index + 1}`;
        return [
          {
            id,
            content: content.slice(0, 300),
            status: normalizePlanStatus(entry.status, "pending"),
          } satisfies PlanItem,
        ];
      })
    : [];
  if (!eventId || items.length === 0) return null;
  return {
    type: "plan",
    event_id: eventId,
    title: title.slice(0, 120) || "Plan",
    items: items.slice(0, 12),
  };
}

export function latestPlanEvent(events: readonly unknown[]): PlanEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const plan = parsePlanEvent(events[i]);
    if (plan) return plan;
  }
  return null;
}

export function planStatusKey(
  plan: Pick<PlanEvent, "items"> | null | undefined,
): string {
  if (!plan) return "";
  return plan.items.map((item) => `${item.id}:${item.status}`).join("\n");
}

const INTERRUPTED_TURN_PREFIX =
  "The response was interrupted before it finished.";

export type PlanSliceStop =
  | "complete"
  | "ask_inputs"
  | "cancelled"
  | "error"
  | "cap"
  | "stall"
  | "no_plan";

export function eventsLookCancelled(events: readonly unknown[]): boolean {
  return events.some((event) => {
    if (!event || typeof event !== "object") return false;
    const row = event as { type?: unknown; text?: unknown; message?: unknown };
    if (row.type === "content" && typeof row.text === "string") {
      return row.text.includes("Cancelled by user.");
    }
    return (
      row.type === "error" &&
      typeof row.message === "string" &&
      row.message.startsWith(INTERRUPTED_TURN_PREFIX)
    );
  });
}

function isHardPlanError(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const row = event as { type?: unknown; message?: unknown };
  if (row.type !== "error" || typeof row.message !== "string") return false;
  if (row.message === INCOMPLETE_TURN_MESSAGE) return false;
  if (row.message.startsWith(INTERRUPTED_TURN_PREFIX)) return false;
  return true;
}

/**
 * Whether the server should run another slice on the same assistant message.
 * A user resume ignores the cap and a stall so Continue can grant another run.
 */
export function decidePlanContinuation(args: {
  events: readonly unknown[];
  cancelled?: boolean;
  slicesCompleted: number;
  previousStatusKey: string | null;
  userResume?: boolean;
}): { continue: boolean; stop: PlanSliceStop | null } {
  if (args.cancelled || eventsLookCancelled(args.events)) {
    return { continue: false, stop: "cancelled" };
  }
  if (args.events.some((event) => parseAskInputs(event))) {
    return { continue: false, stop: "ask_inputs" };
  }
  if (args.events.some((event) => isHardPlanError(event))) {
    return { continue: false, stop: "error" };
  }
  const plan = latestPlanEvent(args.events);
  if (!plan) return { continue: false, stop: "no_plan" };
  if (!planHasPendingItems(plan)) {
    return { continue: false, stop: "complete" };
  }
  if (!args.userResume && args.slicesCompleted >= PLAN_SLICE_CAP) {
    return { continue: false, stop: "cap" };
  }
  const key = planStatusKey(plan);
  if (
    !args.userResume &&
    args.previousStatusKey !== null &&
    args.previousStatusKey === key
  ) {
    return { continue: false, stop: "stall" };
  }
  return { continue: true, stop: null };
}

function parseAskInputs(event: unknown): boolean {
  return (
    !!event &&
    typeof event === "object" &&
    (event as { type?: unknown }).type === "ask_inputs"
  );
}

/**
 * One plan card on the assistant message. New slice events append, and the
 * latest plan replaces the earlier one while keeping its id.
 */
export function mergePlanSliceEvents(
  existing: AssistantEvent[],
  incoming: AssistantEvent[],
): AssistantEvent[] {
  const existingPlan = latestPlanEvent(existing);
  const incomingPlan = latestPlanEvent(incoming);
  const plan = incomingPlan
    ? {
        ...incomingPlan,
        event_id: existingPlan?.event_id ?? incomingPlan.event_id,
      }
    : existingPlan;
  const kept = existing.filter((event) => event.type !== "plan");
  const added = incoming.filter((event) => {
    if (event.type === "plan") return false;
    if (
      event.type === "content" &&
      event.text.trim() === PLAN_PAUSE_CONTENT
    ) {
      return false;
    }
    return true;
  });
  const merged = [...kept, ...added];
  if (!plan) return merged;
  const originalIndex = existing.findIndex((event) => event.type === "plan");
  const before =
    originalIndex >= 0
      ? existing
          .slice(0, originalIndex)
          .filter((event) => event.type !== "plan").length
      : merged.length;
  const next = [...merged];
  next.splice(Math.min(before, next.length), 0, plan);
  return next;
}

export function normalizePlanEvent(
  args: Record<string, unknown>,
  mode: "create" | "update",
  options?: { eventId?: string },
): PlanEvent | null {
  const title = cleanPlanString(args.title, "Plan");
  const rawItems = Array.isArray(args.items) ? args.items : [];
  const items = rawItems
    .flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const content = cleanPlanString(row.content);
      if (!content) return [];
      const id =
        typeof row.id === "string" && row.id.trim()
          ? row.id.trim().slice(0, 80)
          : `step-${index + 1}`;
      return [
        {
          id,
          content: content.slice(0, 300),
          status: normalizePlanStatus(
            row.status,
            mode === "create" ? "pending" : "pending",
          ),
        } satisfies PlanItem,
      ];
    })
    .slice(0, 12);
  if (items.length === 0) return null;
  if (mode === "create" && items.every((item) => item.status === "pending")) {
    items[0] = { ...items[0]!, status: "in_progress" };
  }
  const supplied = options?.eventId?.trim();
  return {
    type: "plan",
    event_id: supplied || crypto.randomUUID(),
    title: title.slice(0, 120) || "Plan",
    items,
  };
}
