import { describe, expect, it } from "vitest";
import {
  LAST_STEP_WRITE_REMINDER,
  PLAN_COMPLETE_SUMMARY,
  PLAN_NOW_REMINDER,
  prepareAssistantStreamStep,
} from "../aiSdk";

describe("prepareAssistantStreamStep", () => {
  it("leaves early steps unchanged", () => {
    expect(
      prepareAssistantStreamStep({
        steps: [],
        maxIterations: 16,
        systemPrompt: "BASE",
      }),
    ).toBeUndefined();
  });

  it("strips tools and asks for a written answer on the last step", () => {
    const prepared = prepareAssistantStreamStep({
      steps: Array.from({ length: 15 }, () => ({ toolCalls: [] })),
      maxIterations: 16,
      systemPrompt: "BASE",
    });

    expect(prepared).toEqual({
      activeTools: [],
      toolChoice: "none",
      system: `BASE\n\n${LAST_STEP_WRITE_REMINDER}`,
    });
  });

  it("adds the CourtListener reminder without stripping tools mid-run", () => {
    const prepared = prepareAssistantStreamStep({
      steps: [
        {
          toolCalls: [{ toolName: "courtlistener_read_case" }],
        },
      ],
      maxIterations: 16,
      systemPrompt: "BASE",
      courtlistenerReminder: true,
    });

    expect(prepared?.activeTools).toBeUndefined();
    expect(prepared?.system).toContain("COURTLISTENER CITATION REMINDER");
    expect(prepared?.system).not.toContain("LAST STEP");
  });

  it("lets a plan-required turn look before it must call create_plan", () => {
    expect(
      prepareAssistantStreamStep({
        steps: [],
        maxIterations: 2,
        systemPrompt: "BASE",
        requirePlan: true,
      }),
    ).toEqual({ toolChoice: "required" });
  });

  it("forces create_plan after a read and does not open a writing step", () => {
    const prepared = prepareAssistantStreamStep({
      steps: [{ toolCalls: [{ toolName: "read_document" }] }],
      maxIterations: 2,
      systemPrompt: "BASE",
      requirePlan: true,
    });

    expect(prepared).toEqual({
      activeTools: ["create_plan"],
      toolChoice: { type: "tool", toolName: "create_plan" },
      system: `BASE\n\n${PLAN_NOW_REMINDER}`,
    });
    expect(prepared?.system).not.toContain(LAST_STEP_WRITE_REMINDER);
    expect(prepared?.toolChoice).not.toBe("none");
  });

  it("writes the summary instead of calling tools once the plan is complete", () => {
    const prepared = prepareAssistantStreamStep({
      steps: [{ toolCalls: [{ toolName: "update_plan" }] }],
      maxIterations: 8,
      systemPrompt: "BASE",
      planSummaryNow: { current: true },
    });

    expect(prepared).toEqual({
      activeTools: [],
      toolChoice: "none",
      system: `BASE\n\n${PLAN_COMPLETE_SUMMARY}`,
    });
    expect(prepared?.system).not.toContain(LAST_STEP_WRITE_REMINDER);
  });
});
