import type { ReasoningLevel } from "../../lib/llm";

const REASONING_ORDER: readonly ReasoningLevel[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * A saved prompt follows the user's message. It is not a review workflow,
 * so a filename suggestion does not inherit a High reasoning setting.
 */
const SAVED_PROMPT_TITLES = new Set(["saved prompt", "suggest a filename"]);

function capAtLow(level: ReasoningLevel): ReasoningLevel {
  const index = REASONING_ORDER.indexOf(level);
  const lowIndex = REASONING_ORDER.indexOf("low");
  if (index < 0 || index <= lowIndex) return level;
  return "low";
}

function asksForReview(content: string): boolean {
  return /\b(review|playbook)\b/i.test(content);
}

function isSavedPrompt(workflow: { id?: string; title?: string } | null | undefined): boolean {
  const title = workflow?.title?.trim().toLowerCase() ?? "";
  return SAVED_PROMPT_TITLES.has(title);
}

/**
 * Questions and direct edits stay at Low even when the chat is set higher.
 * A review, a playbook, or a selected workflow keeps the chosen level.
 * None stays None: the cap does not add thinking.
 */
export function wordTurnReasoningLevel(args: {
  selected: ReasoningLevel;
  content: string | null | undefined;
  workflow?: { id: string; title: string } | null;
}): ReasoningLevel {
  const content = args.content ?? "";
  const workflowSelected = Boolean(args.workflow?.id || args.workflow?.title);
  if (
    asksForReview(content) ||
    (workflowSelected && !isSavedPrompt(args.workflow))
  ) {
    return args.selected;
  }
  return capAtLow(args.selected);
}
