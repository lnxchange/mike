import type { AssistantEvent } from "@/app/components/shared/types";

export const CONTINUE_PLAN_MESSAGE = "Continue with the next step.";

/** Matches the backend incomplete-turn message. A hard failure does not. */
const INCOMPLETE_TURN_MESSAGE =
  "The response stopped after reading documents and before writing the answer. Ask me to continue. I will write from what was already read rather than starting the research again.";

/** Enough for a full plan, one or two items at a time, then stop. */
export const AUTO_CONTINUE_LIMIT = 12;

function latestPlan(events: AssistantEvent[]) {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.type === "plan") return event;
  }
  return null;
}

/**
 * Keep going when a slice stopped with work still to do, or when the turn
 * ran out of room before it wrote the answer. Stop for a question, a hard
 * error, a finished plan, or a cancelled turn.
 */
export function shouldAutoContinue(args: {
  events: AssistantEvent[];
  aborted: boolean;
  continues: number;
}): boolean {
  if (args.aborted) return false;
  if (args.continues >= AUTO_CONTINUE_LIMIT) return false;
  if (args.events.some((event) => event.type === "ask_inputs")) return false;
  const hardError = args.events.some(
    (event) =>
      event.type === "error" && event.message !== INCOMPLETE_TURN_MESSAGE,
  );
  if (hardError) return false;
  const plan = latestPlan(args.events);
  if (plan?.items.some((item) => item.status !== "completed")) return true;
  return args.events.some(
    (event) =>
      event.type === "error" && event.message === INCOMPLETE_TURN_MESSAGE,
  );
}
