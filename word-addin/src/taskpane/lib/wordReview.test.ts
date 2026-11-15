import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatWordReviewSection } from "./wordReview";

describe("formatWordReviewSection", () => {
  it("lists the author of a deletion the body has already dropped", () => {
    const section = formatWordReviewSection({
      changes: [
        {
          kind: "deletion",
          author: "Vith Visagathilagar",
          date: "2026-09-16",
          text: "the other Party's legitimate interests",
        },
      ],
      formattingCount: 2,
      comments: [
        {
          id: "c1",
          author: "Yule Guttenbeil",
          date: "2026-09-16",
          anchor: "Assignment",
          text: "Thanks Vith. We accept that a fixed amount should apply.",
          resolved: false,
          replies: [],
        },
      ],
      revisionsUnread: false,
      commentsUnread: false,
    });

    assert.match(section, /TRACKED CHANGES \(3 pending, 1 comments\)/);
    assert.match(section, /\[deletion\] Vith Visagathilagar, 2026-09-16/);
    assert.match(section, /\[id c1\] Yule Guttenbeil/);
    assert.match(section, /Do not describe this document as clean/);
  });

  it("refuses a clean reading when Word did not return the markup", () => {
    const section = formatWordReviewSection({
      changes: [],
      formattingCount: 0,
      comments: [],
      revisionsUnread: true,
      commentsUnread: true,
    });
    assert.match(section, /not evidence that this document is clean/);
  });

  it("says the document is clean only when Word reported neither", () => {
    const section = formatWordReviewSection({
      changes: [],
      formattingCount: 0,
      comments: [],
      revisionsUnread: false,
      commentsUnread: false,
    });
    assert.match(section, /No pending tracked changes/);
    assert.match(section, /No review comments/);
    assert.match(section, /Only this explicit empty report means the document is clean/);
  });
});
