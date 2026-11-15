import { describe, expect, it } from "vitest";
import {
  INCOMPLETE_TURN_MESSAGE,
  SOURCE_UNAVAILABLE_TURN_MESSAGE,
  isIncompleteDeliverableTurn,
  withIncompleteTurnEvent,
} from "../incompleteTurn";
import type { AssistantEvent } from "@mike/contracts";

const read = (filename: string): AssistantEvent => ({
  type: "doc_read",
  filename,
});

describe("isIncompleteDeliverableTurn", () => {
  it("flags a research pass that never wrote after the last read", () => {
    expect(
      isIncompleteDeliverableTurn([
        { type: "reasoning", text: "Plan the email." },
        {
          type: "content",
          text: "I'll pull the latest correspondence and drafts.",
        },
        read("msa.docx"),
        read("sow.docx"),
        { type: "reasoning", text: "Now draft clause 13." },
      ]),
    ).toBe(true);
  });

  it("accepts a short answer written after the last read", () => {
    expect(
      isIncompleteDeliverableTurn([
        read("lease.pdf"),
        { type: "content", text: "Clause 5 is a mutual non-solicit." },
      ]),
    ).toBe(false);
  });

  it("accepts a turn that recorded a plan", () => {
    expect(
      isIncompleteDeliverableTurn([
        read("brief.docx"),
        {
          type: "plan",
          event_id: "plan-1",
          title: "New job request",
          items: [
            { id: "read", content: "Read the emails", status: "in_progress" },
            { id: "review", content: "Review the terms", status: "pending" },
          ],
        },
      ]),
    ).toBe(false);
  });

  it("accepts a turn that created or edited a document", () => {
    expect(
      isIncompleteDeliverableTurn([
        read("msa.docx"),
        {
          type: "doc_created",
          filename: "cover-email.docx",
          download_url: "/x",
        },
      ]),
    ).toBe(false);
  });

  it("accepts a turn that finalised a clean copy", () => {
    expect(
      isIncompleteDeliverableTurn([
        read("msa.docx"),
        {
          type: "doc_finalized",
          filename: "msa (clean).docx",
          document_id: "clean",
          version_id: "v1",
          version_number: 1,
          source_document_id: "src",
          source_filename: "msa.docx",
          download_url: "/x",
          accepted: 4,
          comments_removed: 0,
        },
      ]),
    ).toBe(false);
  });

  it("leaves ordinary chat turns alone", () => {
    expect(
      isIncompleteDeliverableTurn([
        { type: "content", text: "Hello, how can I help?" },
      ]),
    ).toBe(false);
  });

  it("appends a user-visible error only when the turn is incomplete", () => {
    const incomplete: AssistantEvent[] = [
      { type: "content", text: "I'll start by reviewing." },
      read("notes.eml"),
    ];
    expect(withIncompleteTurnEvent(incomplete).at(-1)).toEqual({
      type: "error",
      message: INCOMPLETE_TURN_MESSAGE,
      safe_to_display: true,
    });
    expect(
      withIncompleteTurnEvent([
        { type: "content", text: "Here is the email." },
      ]),
    ).toHaveLength(1);
  });

  it("asks for an upload when an official source was inaccessible", () => {
    const events: AssistantEvent[] = [
      {
        type: "au_get_energy",
        title_id: "sa:nerl",
        section: "5",
        error: "I could not download the official text of National Energy Retail Law.",
        safe_to_display: true,
      },
    ];
    expect(withIncompleteTurnEvent(events).at(-1)).toEqual({
      type: "error",
      message: SOURCE_UNAVAILABLE_TURN_MESSAGE,
      safe_to_display: true,
    });
  });
});
