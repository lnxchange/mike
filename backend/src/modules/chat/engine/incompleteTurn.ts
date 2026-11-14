import type { AssistantEvent } from "@mike/contracts";

const DELIVERABLE_EVENT_TYPES = new Set([
  "doc_created",
  "doc_edited",
  "doc_replicated",
  "doc_finalized",
  "ask_inputs",
  "plan",
]);

export const INCOMPLETE_TURN_MESSAGE =
  "The response stopped after reading documents and before writing the answer. Ask me to continue. I will write from what was already read rather than starting the research again.";

export const SOURCE_UNAVAILABLE_TURN_MESSAGE =
  "An official source could not be reached. I have stopped rather than inventing the text. Upload the official compilation or the relevant extract and I will continue from that.";

function hasOfficialSourceUnavailable(events: AssistantEvent[]): boolean {
  return events.some(
    (event) =>
      "error" in event &&
      typeof event.error === "string" &&
      event.error &&
      "safe_to_display" in event &&
      event.safe_to_display === true,
  );
}

function isDeliverableEvent(event: AssistantEvent): boolean {
  return DELIVERABLE_EVENT_TYPES.has(event.type);
}

function isResearchEvent(event: AssistantEvent): boolean {
  if (event.type === "doc_read" || event.type === "doc_find") return true;
  if (event.type === "mcp_tool_call") return true;
  return (
    event.type.startsWith("courtlistener_") || event.type.startsWith("au_")
  );
}

export function isIncompleteDeliverableTurn(
  events: AssistantEvent[],
): boolean {
  if (events.some((event) => event.type === "error")) return false;
  if (events.some(isDeliverableEvent)) return false;
  if (!events.some(isResearchEvent)) return false;

  let lastResearch = -1;
  for (let i = 0; i < events.length; i++) {
    if (isResearchEvent(events[i]!)) lastResearch = i;
  }
  const contentAfter = events
    .slice(lastResearch + 1)
    .filter(
      (event): event is Extract<AssistantEvent, { type: "content" }> =>
        event.type === "content",
    )
    .map((event) => event.text.trim())
    .filter(Boolean)
    .join("\n");
  return contentAfter.length === 0;
}

export function withIncompleteTurnEvent(
  events: AssistantEvent[],
): AssistantEvent[] {
  if (!isIncompleteDeliverableTurn(events)) return events;
  return [
    ...events,
    {
      type: "error",
      message: hasOfficialSourceUnavailable(events)
        ? SOURCE_UNAVAILABLE_TURN_MESSAGE
        : INCOMPLETE_TURN_MESSAGE,
      safe_to_display: true,
    },
  ];
}
