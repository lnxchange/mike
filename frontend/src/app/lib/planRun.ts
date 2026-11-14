import type { AssistantEvent, Message } from "@/app/components/shared/types";

const INCOMPLETE_TURN_MESSAGE =
    "The response stopped after reading documents and before writing the answer. Ask me to continue. I will write from what was already read rather than starting the research again.";

const INTERRUPTED_TURN_PREFIX =
    "The response was interrupted before it finished.";

export type PlanSettleReason = "finished" | "needs_input" | "stopped";

function latestPlan(events: AssistantEvent[]) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.type === "plan") return event;
    }
    return null;
}

function looksCancelled(events: AssistantEvent[]): boolean {
    return events.some((event) => {
        if (event.type === "content") {
            return event.text.includes("Cancelled by user.");
        }
        return (
            event.type === "error" &&
            event.message.startsWith(INTERRUPTED_TURN_PREFIX)
        );
    });
}

function hasPendingAsk(events: AssistantEvent[]): boolean {
    let pending = false;
    for (const event of events) {
        if (event.type === "ask_inputs") pending = true;
        if (event.type === "ask_inputs_response") pending = false;
    }
    return pending;
}

function hasHardError(events: AssistantEvent[]): boolean {
    return events.some(
        (event) =>
            event.type === "error" &&
            event.message !== INCOMPLETE_TURN_MESSAGE &&
            !event.message.startsWith(INTERRUPTED_TURN_PREFIX),
    );
}

export function assistantEvents(message: Message | undefined): AssistantEvent[] {
    return message?.events ?? [];
}

export function latestAssistant(messages: Message[]): Message | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === "assistant") return messages[index];
    }
    return undefined;
}

/** The stream ended with work left, so the tab should attach to the server. */
export function shouldFollowServerPlan(events: AssistantEvent[]): boolean {
    const plan = latestPlan(events);
    if (!plan?.items.some((item) => item.status !== "completed")) return false;
    if (looksCancelled(events) || hasPendingAsk(events) || hasHardError(events)) {
        return false;
    }
    return true;
}

/** A reopened chat whose plan is unfinished and not cancelled. */
export function shouldResumeIdlePlan(messages: Message[]): boolean {
    return shouldFollowServerPlan(assistantEvents(latestAssistant(messages)));
}

export function planSettleReason(
    events: AssistantEvent[],
): PlanSettleReason | null {
    const plan = latestPlan(events);
    if (!plan || looksCancelled(events)) return null;
    if (hasPendingAsk(events)) return "needs_input";
    if (hasHardError(events)) return "stopped";
    if (plan.items.some((item) => item.status !== "completed")) return "stopped";
    return "finished";
}
