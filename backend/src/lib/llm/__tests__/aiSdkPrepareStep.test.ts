import { describe, expect, it } from "vitest";
import {
  LAST_STEP_WRITE_REMINDER,
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
});
