import type { PlanEvent, PlanItem, PlanItemStatus } from "@mike/contracts";

export const CREATE_PLAN_REQUIRED_ERROR =
  "Call create_plan with the remaining steps, then stop. Do not draft, copy, edit, or generate documents in this response.";

export const PLAN_SLICE_WRITE_REMINDER = `PLAN SLICE: Do not call any tools. Write a short progress note for the work just done. Do not start the next plan item.`;

export const PLAN_PAUSE_CONTENT =
  "I will work through this one step at a time.";

export const PLAN_CONTINUE_MESSAGE = "Continue with the next step.";

/** Continuation budget: enough to read and produce one slice, not a whole job. */
export const PLAN_SLICE_MAX_ITERATIONS = 8;

export const PLAN_FIRST_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
  "edit_document",
  "replicate_document",
  "finalize_document",
  "generate_docx",
  "generate_excel",
  "generate_ppt",
  "create_outlook_draft",
  "apply_word_edits",
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

export function latestPlanEvent(events: unknown[]): PlanEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const plan = parsePlanEvent(events[i]);
    if (plan) return plan;
  }
  return null;
}

export function normalizePlanEvent(
  args: Record<string, unknown>,
  mode: "create" | "update",
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
  return {
    type: "plan",
    event_id: crypto.randomUUID(),
    title: title.slice(0, 120) || "Plan",
    items,
  };
}
