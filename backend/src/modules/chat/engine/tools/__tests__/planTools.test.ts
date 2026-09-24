import { describe, expect, it } from "vitest";
import {
  ACTIVE_PLAN_MARKER,
  formatActivePlanBlock,
  lastUserHasWorkflow,
  latestPlanEvent,
  messagesHaveActivePlan,
  normalizePlanEvent,
  planHasPendingItems,
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
        { role: "user", content: "[Workflow: New job request (id: wf-1)]\n\nGo" },
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
