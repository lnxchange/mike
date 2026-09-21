import { describe, expect, it } from "vitest";

import {
  emailToHtml,
  emailToText,
  extractInternetMessageId,
  fileableAttachments,
  inlineCidImages,
  normalizeInternetMessageId,
  normalizeMailboxSubject,
  parseEmail,
  sanitizeEmailHtml,
} from "../emailMessage";

const EML = [
  "From: Yule Guttenbeil <yule@attune.legal>",
  "To: Client Person <client@example.com>",
  "Cc: Colleague <colleague@example.com>",
  "Subject: Northeon JV - draft shareholders agreement",
  "Message-ID: <northeon-jv@attune.legal>",
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
    expect(email.messageId).toBe("<northeon-jv@attune.legal>");
    expect(email.text).toContain("Attached is the draft for your review.");
    expect(email.attachments.map((a) => a.filename)).toEqual([
      "Shareholders Agreement.pdf",
      "logo.png",
      "notes.txt",
    ]);
    expect(email.attachments[1]?.inline).toBe(true);
    expect(email.attachments[1]?.cid).toBe("logo@cid");
  });

  it("normalises Message-ID and mailbox subjects", () => {
    expect(normalizeInternetMessageId("abc@example.com")).toBe(
      "<abc@example.com>",
    );
    expect(extractInternetMessageId(Buffer.from(EML), "eml")).toBe(
      "<northeon-jv@attune.legal>",
    );
    expect(normalizeMailboxSubject("Re: Fw: Schedule")).toBe("Schedule");
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
    expect(html).toContain(
      '<td class="email-subject" colspan="2">Re: &lt;urgent&gt; &amp; confidential</td>',
    );
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("<hr");
    expect(html).not.toMatch(/<body>\s*<p[\s>]/);
    expect(html).toContain("<th>From</th><td>Yule Guttenbeil &lt;yule@attune.legal&gt;</td>");
    expect(html).toContain("Shareholders Agreement.pdf, notes.txt (not imported)");
    expect(html).toContain("<pre");
    expect(html).toContain("Attached is the draft for your review.");
  });

  it("inlines cid signature images and drops Outlook page styles", () => {
    const html = emailToHtml({
      subject: "Signed",
      from: [{ name: "Yule", address: "yule@attune.legal" }],
      to: [],
      cc: [],
      bcc: [],
      date: null,
      text: "",
      html: `<html><head>
<meta http-equiv="Content-Type" content="text/html; charset=Windows-1252">
<style>
@page WordSection1 { size:8.5in 11.0in; margin:1.0in; }
div.WordSection1 { page:WordSection1; }
p.MsoNormal { font-family:Calibri; }
</style>
</head>
<body>
<div class="WordSection1">
<p class="MsoNormal">Kind regards,</p>
<img src="cid:attune-logo" alt="Attune">
<p>The client\u2019s draft.</p>
</div>
</body></html>`,
      attachments: [
        {
          filename: "logo.png",
          contentType: "image/png",
          content: Buffer.from("png"),
          inline: true,
          cid: "attune-logo",
          embeddedMessage: false,
        },
      ],
    });
    expect(html).toContain('src="data:image/png;base64,cG5n"');
    expect(html).not.toContain("cid:attune-logo");
    expect(html).not.toContain("Windows-1252");
    expect(html).not.toContain("@page");
    expect(html).not.toMatch(/page\s*:\s*WordSection1/);
    expect(html).toContain("The client\u2019s draft.");
    expect(html).toContain("p.MsoNormal { font-family:Calibri; }");
  });
});

describe("inlineCidImages", () => {
  it("matches cid values with or without the domain suffix", () => {
    const html = inlineCidImages('<img src="cid:logo@cid" alt="logo">', [
      {
        filename: "logo.png",
        contentType: "image/png",
        content: Buffer.from("png"),
        inline: true,
        cid: "logo@cid",
        embeddedMessage: false,
      },
    ]);
    expect(html).toContain('src="data:image/png;base64,cG5n"');
  });
});

describe("sanitizeEmailHtml", () => {
  it("strips scripts, event handlers and remote or leftover cid images", () => {
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

  it("takes the body only and drops charset metas that would re-decode UTF-8", () => {
    const dirty = `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Type" content="text/html; charset=Windows-1252">
<style>@page WordSection1 { margin:1in; } p { color:#222; }</style>
</head><body><p>The client\u2019s café</p></body></html>`;
    const clean = sanitizeEmailHtml(dirty);
    expect(clean).not.toContain("Windows-1252");
    expect(clean).not.toContain("<html");
    expect(clean).not.toContain("<body");
    expect(clean).not.toContain("@page");
    expect(clean).toContain("The client\u2019s café");
    expect(clean).toContain("p { color:#222; }");
  });
});
