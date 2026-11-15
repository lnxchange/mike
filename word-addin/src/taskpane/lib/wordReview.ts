/**
 * The review appendix Mike reads with a live Word document.
 *
 * Body markdown is the current text: insertions look settled and deletions
 * are gone, so a marked-up agreement reads as clean unless this section
 * lists the redline and the comment bubbles.
 */

export type WordReviewKind = "insertion" | "deletion" | "move" | "replace";

export interface WordReviewChange {
  kind: WordReviewKind;
  author: string;
  date: string;
  /** Empty when Word returned the revision but not its text (common for Mac deletions). */
  text: string;
}

export interface WordReviewReply {
  author: string;
  date: string;
  text: string;
}

export interface WordReviewComment {
  id: string;
  author: string;
  date: string;
  anchor: string;
  text: string;
  resolved: boolean;
  replies: WordReviewReply[];
}

const LIST_LIMIT = 60;
const SNIPPET_CHARS = 240;

function oneLine(value: string, max = SNIPPET_CHARS): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

function byline(author: string, date: string): string {
  const who = author.trim() || "unknown author";
  return date ? `${who}, ${date}` : who;
}

export function formatWordReviewSection(input: {
  changes: WordReviewChange[];
  formattingCount: number;
  comments: WordReviewComment[];
  revisionsUnread: boolean;
  commentsUnread: boolean;
}): string {
  const { changes, formattingCount, comments, revisionsUnread, commentsUnread } =
    input;
  const lines: string[] = [];

  if (revisionsUnread && commentsUnread) {
    lines.push("--- TRACKED CHANGES ---");
    lines.push(
      "Word did not return the pending redline or the review comments. The body text above is not evidence that this document is clean.",
    );
    return lines.join("\n");
  }

  const pending = changes.length + formattingCount;
  const headingBits = [
    revisionsUnread ? "redline unread" : `${pending} pending`,
    commentsUnread ? "comments unread" : `${comments.length} comments`,
  ];
  lines.push(`--- TRACKED CHANGES (${headingBits.join(", ")}) ---`);
  lines.push(
    "The body text above keeps pending insertions and omits pending deletions. It does not name an author. This section is the redline and the review comments.",
  );

  if (revisionsUnread) {
    lines.push(
      "Word did not return the pending tracked changes. Do not say the document has no markup.",
    );
  } else if (changes.length === 0 && formattingCount === 0) {
    lines.push("No pending tracked changes.");
  } else {
    lines.push("Pending revisions:");
    const listed = changes.slice(0, LIST_LIMIT);
    listed.forEach((change, index) => {
      const snippet = oneLine(change.text);
      const body = snippet
        ? `"${snippet}"`
        : "(Word did not return the changed text)";
      lines.push(
        `${index + 1}. [${change.kind}] ${byline(change.author, change.date)}: ${body}`,
      );
    });
    if (changes.length > listed.length) {
      const rest = new Map<string, number>();
      for (const change of changes.slice(listed.length)) {
        const author = change.author.trim() || "unknown author";
        rest.set(author, (rest.get(author) ?? 0) + 1);
      }
      const tally = [...rest.entries()]
        .map(([author, count]) => `${author} ${count}`)
        .join(", ");
      lines.push(
        `(and ${changes.length - listed.length} more revisions not listed: ${tally})`,
      );
    }
    if (formattingCount > 0) {
      lines.push(
        `Formatting-only revisions not listed individually: ${formattingCount}.`,
      );
    }
  }

  if (commentsUnread) {
    lines.push(
      "Word did not return the review comments. Do not say the document has no comments.",
    );
  } else if (comments.length === 0) {
    lines.push("No review comments.");
  } else {
    lines.push("Review comments:");
    comments.slice(0, LIST_LIMIT).forEach((comment, index) => {
      const anchor = oneLine(comment.anchor, 160);
      const state = comment.resolved ? " [resolved]" : "";
      lines.push(
        `${index + 1}. [id ${comment.id}] ${byline(comment.author, comment.date)}` +
          `${anchor ? ` on "${anchor}"` : ""}${state}: "${oneLine(comment.text)}"`,
      );
      comment.replies.forEach((reply) => {
        lines.push(
          `   reply ${byline(reply.author, reply.date)}: "${oneLine(reply.text)}"`,
        );
      });
    });
    if (comments.length > LIST_LIMIT) {
      lines.push(`(and ${comments.length - LIST_LIMIT} more comments not listed)`);
    }
  }

  if (!revisionsUnread && !commentsUnread && pending === 0 && comments.length === 0) {
    lines.push(
      "Only this explicit empty report means the document is clean. Do not infer that from the body.",
    );
  } else if (pending > 0 || comments.length > 0) {
    lines.push(
      "Do not describe this document as clean, and do not say a revision or comment is missing, while this section lists it.",
    );
  }

  return lines.join("\n");
}
