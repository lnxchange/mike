import { describe, expect, it } from "vitest";
import type { AssistantEvent } from "@/app/components/shared/types";
import { AUTO_CONTINUE_LIMIT, shouldAutoContinue } from "./autoContinuePlan";

const pendingPlan: AssistantEvent = {
  type: "plan",
  event_id: "plan-1",
  title: "BP confirmation",
  items: [
    { id: "read", content: "Read the draft", status: "completed" },
    { id: "note", content: "Draft the covering note", status: "pending" },
  ],
};

const finishedPlan: AssistantEvent = {
  type: "plan",
  event_id: "plan-2",
  title: "BP confirmation",
  items: [
    { id: "read", content: "Read the draft", status: "completed" },
    { id: "note", content: "Draft the covering note", status: "completed" },
  ],
};

describe("shouldAutoContinue", () => {
  it("continues a plan that still has pending work", () => {
    expect(
      shouldAutoContinue({
        events: [pendingPlan],
        aborted: false,
        continues: 0,
      }),
    ).toBe(true);
  });

  it("stops once every plan item is done", () => {
    expect(
      shouldAutoContinue({
        events: [
          finishedPlan,
          { type: "content", text: "Both markups are in the document." },
        ],
        aborted: false,
        continues: 2,
      }),
    ).toBe(false);
  });

  it("continues a turn that stopped before the answer was written", () => {
    expect(
      shouldAutoContinue({
        events: [
          {
            type: "error",
            message:
              "The response stopped after reading documents and before writing the answer. Ask me to continue. I will write from what was already read rather than starting the research again.",
            safe_to_display: true,
          },
        ],
        aborted: false,
        continues: 0,
      }),
    ).toBe(true);
  });

  it("does not continue past a question, a hard error, a cancel, or the cap", () => {
    expect(
      shouldAutoContinue({
        events: [
          pendingPlan,
          {
            type: "ask_inputs",
            event_id: "ask-1",
            items: [],
          },
        ],
        aborted: false,
        continues: 0,
      }),
    ).toBe(false);
    expect(
      shouldAutoContinue({
        events: [
          pendingPlan,
          { type: "error", message: "Sorry, something went wrong." },
        ],
        aborted: false,
        continues: 0,
      }),
    ).toBe(false);
    expect(
      shouldAutoContinue({
        events: [pendingPlan],
        aborted: true,
        continues: 0,
      }),
    ).toBe(false);
    expect(
      shouldAutoContinue({
        events: [pendingPlan],
        aborted: false,
        continues: AUTO_CONTINUE_LIMIT,
      }),
    ).toBe(false);
  });
});
