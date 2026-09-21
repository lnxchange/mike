import { describe, expect, it } from "vitest";
import {
  extractInternetMessageId,
  normalizeInternetMessageId,
  normalizeMailboxSubject,
} from "../emailMessage";

describe("emailMessage", () => {
  it("extracts a Message-ID from an RFC 822 header block", () => {
    const raw = [
      "From: Alissa <alissa@example.com>",
      "Message-ID: <chain-123@example.com>",
      "Subject: Re: Schedule",
      "",
      "Body",
    ].join("\r\n");
    expect(extractInternetMessageId(Buffer.from(raw), "eml")).toBe(
      "<chain-123@example.com>",
    );
  });

  it("ignores non-email types", () => {
    expect(
      extractInternetMessageId("Message-ID: <x@example.com>", "pdf"),
    ).toBeNull();
  });

  it("normalises subjects and message ids", () => {
    expect(normalizeMailboxSubject("Re: Fw: Fwd: Schedule")).toBe("Schedule");
    expect(normalizeInternetMessageId(" chain-123@example.com ")).toBe(
      "<chain-123@example.com>",
    );
  });
});
