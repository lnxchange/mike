import { describe, expect, it } from "vitest";
import {
  ACTIVE_PLAN_MARKER,
  PLAN_CONTINUE_MESSAGE,
  PLAN_WORD_THRESHOLD,
  formatActivePlanBlock,
  lastUserHasWorkflow,
  latestPlanEvent,
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
