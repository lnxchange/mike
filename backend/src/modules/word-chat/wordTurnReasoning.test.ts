import { describe, expect, it } from "vitest";
import { wordTurnReasoningLevel } from "./wordTurnReasoning";

describe("wordTurnReasoningLevel", () => {
  it("caps a direct edit and a question at low", () => {
    expect(
      wordTurnReasoningLevel({
        selected: "high",
        content: "Make this mutual.",
      }),
    ).toBe("low");
    expect(
      wordTurnReasoningLevel({
        selected: "xhigh",
        content: "What is the liability cap?",
      }),
    ).toBe("low");
  });

  it("does not raise a lower setting up to low", () => {
    expect(
      wordTurnReasoningLevel({
        selected: "none",
        content: "Make this mutual.",
      }),
    ).toBe("none");
    expect(
      wordTurnReasoningLevel({ selected: "low", content: "Fix the typo." }),
    ).toBe("low");
  });

  it("keeps the chosen level for a review or a workflow", () => {
    expect(
      wordTurnReasoningLevel({
        selected: "high",
        content: "Review the liability clause.",
      }),
    ).toBe("high");
    expect(
      wordTurnReasoningLevel({
        selected: "high",
        content: "Execute this workflow on this Word document.",
        workflow: { id: "wf-proofread", title: "Proofread" },
      }),
    ).toBe("high");
  });

  it("keeps a saved filename prompt on low unless the message asks for a review", () => {
    const filename =
      "Suggest one filename for this document. Do not edit the document. Use the pattern YYMMDD - Descriptive name.docx.";
    expect(
      wordTurnReasoningLevel({
        selected: "high",
        content: filename,
        workflow: { id: "builtin-saved-prompt", title: "Saved prompt" },
      }),
    ).toBe("low");
    expect(
      wordTurnReasoningLevel({
        selected: "high",
        content: "Review the definitions for consistency.",
        workflow: { id: "builtin-saved-prompt", title: "Saved prompt" },
      }),
    ).toBe("high");
  });
});
