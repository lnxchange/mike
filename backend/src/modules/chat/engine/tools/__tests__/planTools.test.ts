import { describe, expect, it } from "vitest";
import {
  ACTIVE_PLAN_MARKER,
  PLAN_CONTINUE_MESSAGE,
  PLAN_PAUSE_CONTENT,
  PLAN_SLICE_CAP,
  PLAN_WORD_THRESHOLD,
  decidePlanContinuation,
  formatActivePlanBlock,
  lastUserHasWorkflow,
  latestPlanEvent,
  mergePlanSliceEvents,
  messagesHaveActivePlan,
  normalizePlanEvent,
  planHasPendingItems,
  turnRequiresPlan,
} from "../planTools";

describe("normalizePlanEvent", () => {
  it("creates a plan and marks the first item in progress", () => {
    const plan = normalizePlanEvent(
      {
        title: "New job request",
        items: [
          { id: "read", content: "Read the incoming emails" },
          { id: "review", content: "Review the attached terms" },
        ],
      },
      "create",
    );

    expect(plan?.title).toBe("New job request");
    expect(plan?.items).toEqual([
      {
        id: "read",
        content: "Read the incoming emails",
        status: "in_progress",
      },
      {
        id: "review",
        content: "Review the attached terms",
        status: "pending",
      },
    ]);
  });

  it("updates a plan from a full snapshot", () => {
    const plan = normalizePlanEvent(
      {
        items: [
          {
            id: "read",
            content: "Read the incoming emails",
            status: "completed",
          },
          {
            id: "review",
            content: "Review the attached terms",
            status: "in_progress",
          },
        ],
      },
      "update",
    );

    expect(plan?.items.map((item) => item.status)).toEqual([
      "completed",
      "in_progress",
    ]);
    expect(
      normalizePlanEvent(
        {
          items: [
            {
              id: "read",
              content: "Read the incoming emails",
              status: "completed",
            },
          ],
        },
        "update",
        { eventId: "plan-1" },
      )?.event_id,
    ).toBe("plan-1");
  });

  it("rejects an empty plan", () => {
    expect(normalizePlanEvent({ items: [] }, "create")).toBeNull();
  });
});

describe("active plan helpers", () => {
  it("detects a workflow on the latest user message", () => {
    expect(
      lastUserHasWorkflow([
        {
          role: "user",
          content: "[Workflow: New job request (id: wf-1)]\n\nGo",
        },
      ]),
    ).toBe(true);
    expect(
      lastUserHasWorkflow([{ role: "user", content: "Just a question" }]),
    ).toBe(false);
  });

  it("formats a pending plan for the next turn", () => {
    const block = formatActivePlanBlock({
      type: "plan",
      event_id: "plan-1",
      title: "New job request",
      items: [
        { id: "read", content: "Read the emails", status: "completed" },
        { id: "review", content: "Review the terms", status: "pending" },
      ],
    });
    expect(block).toContain(ACTIVE_PLAN_MARKER);
    expect(block).toContain("- pending: Review the terms");
    expect(block).toContain("Execute only the next one or two pending items");
    expect(
      messagesHaveActivePlan([{ role: "assistant", content: block }]),
    ).toBe(true);
    expect(
      planHasPendingItems(latestPlanEvent([{ type: "plan", items: [] }])),
    ).toBe(false);
  });
});

describe("turnRequiresPlan", () => {
  const review =
    "Could you please conduct an initial review of the confirmation that we received today from BP for the urgent review? Give me your thoughts. This is an urgent task, so we're not going to be overly stringent unnecessarily. What I would like to have you do is also explain how the ex-ante energy offset transaction works.";

  it("requires a plan for a long review with no workflow and no documents", () => {
    expect(turnRequiresPlan([{ role: "user", content: review }])).toBe(true);
  });

  it("skips a short question when the chat has no documents", () => {
    expect(
      turnRequiresPlan([{ role: "user", content: "What is an ISDA?" }]),
    ).toBe(false);
    expect(
      turnRequiresPlan([
        {
          role: "user",
          content: Array.from(
            { length: PLAN_WORD_THRESHOLD - 1 },
            () => "word",
          ).join(" "),
        },
      ]),
    ).toBe(false);
  });

  it("requires a plan at the word threshold, with attachments, or when documents are already in the chat", () => {
    expect(
      turnRequiresPlan([
        {
          role: "user",
          content: Array.from(
            { length: PLAN_WORD_THRESHOLD },
            () => "word",
          ).join(" "),
        },
      ]),
    ).toBe(true);
    expect(
      turnRequiresPlan([
        {
          role: "user",
          content: "Thoughts?",
          files: [{ filename: "bp.docx" }],
        },
      ]),
    ).toBe(true);
    expect(
      turnRequiresPlan([{ role: "user", content: "Thoughts?" }], {
        hasDocuments: true,
      }),
    ).toBe(true);
    expect(
      turnRequiresPlan([
        {
          role: "user",
          content:
            "[The user attached the following document(s) to this message:\n- doc-0: BP.docx]\n\nThoughts?",
        },
      ]),
    ).toBe(true);
  });

  it("requires a plan for a selected workflow", () => {
    expect(
      turnRequiresPlan([
        {
          role: "user",
          content: "[Workflow: New job request (id: wf-1)]\n\nGo",
        },
      ]),
    ).toBe(true);
  });

  it("does not force a new plan on Continue or while a plan is already active", () => {
    expect(
      turnRequiresPlan([{ role: "user", content: PLAN_CONTINUE_MESSAGE }]),
    ).toBe(false);
    expect(
      turnRequiresPlan([
        {
          role: "assistant",
          content: `${ACTIVE_PLAN_MARKER}\nTitle: Review`,
        },
        { role: "user", content: review },
      ]),
    ).toBe(false);
  });
});

const pendingPlan = {
  type: "plan" as const,
  event_id: "plan-1",
  title: "Review",
  items: [
    { id: "read", content: "Read the emails", status: "completed" as const },
    { id: "note", content: "Draft the note", status: "pending" as const },
  ],
};

describe("decidePlanContinuation", () => {
  it("continues a pending plan and stops when the plan is finished", () => {
    expect(
      decidePlanContinuation({
        events: [pendingPlan],
        slicesCompleted: 1,
        previousStatusKey: null,
      }).continue,
    ).toBe(true);
    expect(
      decidePlanContinuation({
        events: [
          {
            ...pendingPlan,
            items: pendingPlan.items.map((item) => ({
              ...item,
              status: "completed" as const,
            })),
          },
        ],
        slicesCompleted: 2,
        previousStatusKey: null,
      }),
    ).toEqual({ continue: false, stop: "complete" });
  });

  it("stops for a question, a cancel, a hard error, the cap, or a stall", () => {
    expect(
      decidePlanContinuation({
        events: [
          pendingPlan,
          { type: "ask_inputs", event_id: "ask", items: [] },
        ],
        slicesCompleted: 1,
        previousStatusKey: null,
      }).stop,
    ).toBe("ask_inputs");
    expect(
      decidePlanContinuation({
        events: [
          pendingPlan,
          { type: "content", text: "Cancelled by user." },
        ],
        slicesCompleted: 1,
        previousStatusKey: null,
      }).stop,
    ).toBe("cancelled");
    expect(
      decidePlanContinuation({
        events: [
          pendingPlan,
          { type: "error", message: "Sorry, something went wrong." },
        ],
        slicesCompleted: 1,
        previousStatusKey: null,
      }).stop,
    ).toBe("error");
    expect(
      decidePlanContinuation({
        events: [pendingPlan],
        slicesCompleted: PLAN_SLICE_CAP,
        previousStatusKey: null,
      }).stop,
    ).toBe("cap");
    expect(
      decidePlanContinuation({
        events: [pendingPlan],
        slicesCompleted: 2,
        previousStatusKey: pendingPlan.items
          .map((item) => `${item.id}:${item.status}`)
          .join("\n"),
      }).stop,
    ).toBe("stall");
  });

  it("lets Continue grant another run after a cap or a stall", () => {
    expect(
      decidePlanContinuation({
        events: [pendingPlan],
        slicesCompleted: PLAN_SLICE_CAP,
        previousStatusKey: pendingPlan.items
          .map((item) => `${item.id}:${item.status}`)
          .join("\n"),
        userResume: true,
      }).continue,
    ).toBe(true);
  });
});

describe("mergePlanSliceEvents", () => {
  it("keeps one plan id and drops the between-slice pause line", () => {
    const merged = mergePlanSliceEvents(
      [pendingPlan, { type: "content", text: "Read the first email." }],
      [
        {
          ...pendingPlan,
          event_id: "plan-new",
          items: [
            { id: "read", content: "Read the emails", status: "completed" },
            { id: "note", content: "Draft the note", status: "in_progress" },
          ],
        },
        { type: "content", text: PLAN_PAUSE_CONTENT },
        { type: "content", text: "Drafted the note." },
      ],
    );
    const plans = merged.filter((event) => event.type === "plan");
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ event_id: "plan-1" });
    expect(
      merged.some(
        (event) =>
          event.type === "content" && event.text === PLAN_PAUSE_CONTENT,
      ),
    ).toBe(false);
    expect(
      merged.some(
        (event) =>
          event.type === "content" && event.text === "Drafted the note.",
      ),
    ).toBe(true);
  });
});
