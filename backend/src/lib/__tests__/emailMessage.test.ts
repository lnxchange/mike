import { describe, expect, it } from "vitest";

import {
  emailToHtml,
  emailToText,
  fileableAttachments,
  parseEmail,
  sanitizeEmailHtml,
} from "../emailMessage";

const EML = [
  "From: Yule Guttenbeil <yule@attune.legal>",
  "To: Client Person <client@example.com>",
  "Cc: Colleague <colleague@example.com>",
  "Subject: Northeon JV - draft shareholders agreement",
  "Date: Mon, 21 Jul 2026 09:30:00 +1000",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="b1"',
  "",
  "--b1",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hi Client,",
  "",
  "Attached is the draft for your review.",
  "",
  "Kind regards,",
  "Yule",
  "--b1",
  "Content-Type: application/pdf",
  'Content-Disposition: attachment; filename="Shareholders Agreement.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("%PDF-1.4 fake").toString("base64"),
  "--b1",
  "Content-Type: image/png",
  "Content-ID: <logo@cid>",
  'Content-Disposition: inline; filename="logo.png"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("png").toString("base64"),
  "--b1",
  "Content-Type: text/plain",
  'Content-Disposition: attachment; filename="notes.txt"',
  "",
  "not a supported document type",
  "--b1--",
  "",
].join("\r\n");

describe("parseEmail (eml)", () => {
  it("reads headers, body and attachments", async () => {
    const email = await parseEmail(Buffer.from(EML), "eml");
    expect(email.subject).toBe("Northeon JV - draft shareholders agreement");
    expect(email.from).toEqual([
      { name: "Yule Guttenbeil", address: "yule@attune.legal" },
    ]);
    expect(email.to[0]?.address).toBe("client@example.com");
    expect(email.cc[0]?.address).toBe("colleague@example.com");
    expect(email.date?.toISOString()).toBe("2026-07-20T23:30:00.000Z");
    expect(email.text).toContain("Attached is the draft for your review.");
    expect(email.attachments.map((a) => a.filename)).toEqual([
      "Shareholders Agreement.pdf",
      "logo.png",
      "notes.txt",
    ]);
    expect(email.attachments[1]?.inline).toBe(true);
  });

  it("rejects unknown email types", async () => {
    await expect(parseEmail(Buffer.from("x"), "txt")).rejects.toThrow(
      /Unsupported email type/,
    );
  });
});

describe("fileableAttachments", () => {
  it("keeps real attachments of allowed types and drops inline images", async () => {
    const email = await parseEmail(Buffer.from(EML), "eml");
    const allowed = new Set(["pdf", "docx"]);
    const filed = fileableAttachments(email, (type) => allowed.has(type));
    expect(filed.map((a) => a.filename)).toEqual(["Shareholders Agreement.pdf"]);
  });
});

describe("emailToText", () => {
  it("lays out headers, body and the attachment list", async () => {
    const email = await parseEmail(Buffer.from(EML), "eml");
    const text = emailToText(email);
    expect(text).toMatch(/^Subject: Northeon JV - draft shareholders agreement/);
    expect(text).toContain("From: Yule Guttenbeil <yule@attune.legal>");
    expect(text).toContain(
      "Attachments: Shareholders Agreement.pdf, notes.txt",
    );
    expect(text).not.toContain("logo.png");
    expect(text).toContain("Kind regards,\nYule");
  });

  it("falls back to the HTML body when there is no plain text", () => {
    const text = emailToText({
      subject: "Hello",
      from: [],
      to: [],
      cc: [],
      bcc: [],
      date: null,
      text: "",
      html: "<p>First paragraph.</p><p>Second <b>bold</b> paragraph.</p>",
      attachments: [],
    });
    expect(text).toContain("First paragraph.");
    expect(text).toContain("Second bold paragraph.");
  });
});

describe("emailToHtml", () => {
  it("renders a header table, escapes content and marks unimported attachments", async () => {
    const email = await parseEmail(Buffer.from(EML), "eml");
    email.subject = "Re: <urgent> & confidential";
    const html = emailToHtml(email, {
      importedAttachments: ["Shareholders Agreement.pdf"],
    });
    expect(html).toContain("<h1>Re: &lt;urgent&gt; &amp; confidential</h1>");
    expect(html).toContain("<th>From</th><td>Yule Guttenbeil &lt;yule@attune.legal&gt;</td>");
    expect(html).toContain("Shareholders Agreement.pdf, notes.txt (not imported)");
    expect(html).toContain("<pre");
    expect(html).toContain("Attached is the draft for your review.");
  });
});

describe("sanitizeEmailHtml", () => {
  it("strips scripts, event handlers and remote or cid images", () => {
    const dirty = [
      "<p onclick=\"steal()\">Hi</p>",
      "<script>alert(1)</script>",
      '<img src="https://tracker.example/pixel.gif">',
      '<img src="cid:logo@cid" alt="logo">',
      '<img src="data:image/png;base64,AAAA">',
      "<a href=\"https://example.com\">link</a>",
    ].join("");
    const clean = sanitizeEmailHtml(dirty);
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("tracker.example");
    expect(clean).not.toContain("cid:logo");
    expect(clean).toContain('<img src="data:image/png;base64,AAAA">');
    expect(clean).toContain('<a href="https://example.com">link</a>');
  });
});
