import { describe, expect, it } from "vitest";
import {
  appendOutlookSignature,
  embedSignatureImages,
  extractOutlookSignatureHtml,
  materializeStoredSignature,
  outlookInnerHtmlFromDraftBody,
  referencedContentIds,
  sanitizeStoredSignatureHtml,
  wrapOutlookHtmlDocument,
} from "../outlookDraftHtml";

describe("outlookInnerHtmlFromDraftBody", () => {
  it("turns markdown lists and emphasis into Outlook HTML", () => {
    const html = outlookInnerHtmlFromDraftBody(
      [
        "Hi Alissa,",
        "",
        "Please find **attached**:",
        "",
        "- the special conditions schedule",
        "- the comparison note",
        "",
        "Kind regards,",
      ].join("\n"),
    );
    expect(html).toContain("<p>Hi Alissa,</p>");
    expect(html).toContain("Please find <b>attached</b>:");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>the special conditions schedule</li>");
    expect(html).toContain("<p>Kind regards,</p>");
  });

  it("keeps existing HTML lists and converts leftover markdown bold", () => {
    const html = outlookInnerHtmlFromDraftBody(
      "<p>Please find **attached**:</p><ul><li>the schedule</li></ul><p>Kind regards,</p>",
    );
    expect(html).toContain("<b>attached</b>");
    expect(html).toContain("<ul><li>the schedule</li></ul>");
  });

  it("strips script tags from HTML bodies", () => {
    const html = outlookInnerHtmlFromDraftBody(
      '<p>Hi</p><script>alert(1)</script><p>Kind regards,</p>',
    );
    expect(html).not.toContain("script");
    expect(html).not.toContain("alert");
  });
});

describe("wrapOutlookHtmlDocument", () => {
  it("wraps inner markup in a Calibri HTML document", () => {
    const wrapped = wrapOutlookHtmlDocument("<p>Kind regards,</p>");
    expect(wrapped).toContain("font-family:Calibri");
    expect(wrapped).toContain("<p>Kind regards,</p>");
  });
});

describe("extractOutlookSignatureHtml", () => {
  it("prefers a Signature div", () => {
    const html = extractOutlookSignatureHtml(
      '<p>Hi</p><p>Kind regards,</p><div id="Signature"><b>Yule Guttenbeil</b></div>',
    );
    expect(html).toContain('id="Signature"');
    expect(html).toContain("Yule Guttenbeil");
  });

  it("takes the markup after Kind regards when there is no Signature div", () => {
    const html = extractOutlookSignatureHtml(
      "<p>Hi Alissa,</p><p>Kind regards,</p><table><tr><td>Yule Guttenbeil<br>Principal</td></tr></table>",
    );
    expect(html).toContain("Yule Guttenbeil");
    expect(html).not.toContain("Hi Alissa");
  });

  it("rejects quoted thread remnants", () => {
    expect(
      extractOutlookSignatureHtml(
        '<p>Kind regards,</p><div id="divRplyFwdMsg">From: Alissa</div>',
      ),
    ).toBeNull();
  });

  it("keeps the signature that sits above a quoted thread", () => {
    const html = extractOutlookSignatureHtml(
      [
        "<p>Hi Alissa,</p><p>Kind regards,</p>",
        '<div id="Signature"><b>Yule Guttenbeil</b><br>Principal</div>',
        '<div id="divRplyFwdMsg">From: Alissa Sent: Monday</div>',
      ].join(""),
    );
    expect(html).toContain("Yule Guttenbeil");
    expect(html).not.toContain("divRplyFwdMsg");
    expect(html).not.toContain("Hi Alissa");
  });

  it("keeps a Signature div that also has another class", () => {
    const html = extractOutlookSignatureHtml(
      '<div class="elementToProof">Kind regards,</div><div id="Signature" class="elementToProof"><div><b>Yule Guttenbeil</b><br>Principal<br>yule@attune.legal</div></div>',
    );
    expect(html).toContain("yule@attune.legal");
    expect(html).toContain('id="Signature"');
  });

  it("keeps the block Outlook places after appendonsend", () => {
    const html = extractOutlookSignatureHtml(
      '<div>Kind regards,</div><div id="appendonsend"></div><table><tr><td>Yule Guttenbeil<br>Principal<br>yule@attune.legal</td></tr></table>',
    );
    expect(html).toContain("yule@attune.legal");
    expect(html).not.toContain("appendonsend");
  });

  it("keeps a signature table that has no Signature div", () => {
    const html = extractOutlookSignatureHtml(
      [
        "<p>Kind regards,</p>",
        "<table><tr><td>Yule Guttenbeil<br>Principal<br>yule@attune.legal</td></tr></table>",
        "<blockquote>From: Alissa<br>Sent: Monday</blockquote>",
      ].join(""),
    );
    expect(html).toContain("yule@attune.legal");
    expect(html).not.toContain("blockquote");
  });

  it("does not treat a quoted reply as the signature when From and Sent are in separate tags", () => {
    const html = extractOutlookSignatureHtml(
      [
        "<p>Kind regards,</p>",
        "<table><tr><td>Yule Guttenbeil<br>Principal<br>yule@attune.legal</td></tr></table>",
        "<div><b>From:</b> Alissa Riedel<br><b>Sent:</b> Monday</div>",
        "<p>Hi Yule,</p>",
      ].join(""),
    );
    expect(html).toContain("yule@attune.legal");
    expect(html).not.toContain("Alissa");
  });
});

describe("appendOutlookSignature", () => {
  it("appends once and then stays put", () => {
    const first = appendOutlookSignature(
      "<p>Kind regards,</p>",
      '<div id="Signature">Yule</div>',
    );
    expect(first).toContain("data-mike-sig");
    expect(first).toContain("Yule");
    const second = appendOutlookSignature(first, '<div id="Signature">Again</div>');
    expect(second).toBe(first);
  });
});

describe("stored signature", () => {
  it("keeps a logo inside the html and restores it as an inline image", () => {
    const stored = embedSignatureImages(
      '<div id="Signature"><img src="cid:attune-logo"><b>Yule Guttenbeil</b></div>',
      [
        {
          contentId: "attune-logo",
          contentType: "image/png",
          bytes: Buffer.from("png"),
        },
      ],
    );
    expect(stored).toContain("data:image/png;base64,cG5n");
    const staged = materializeStoredSignature(stored);
    expect(staged.rejected).toBe(false);
    expect(staged.html).toContain('src="cid:mike-signature-1"');
    expect(staged.html).toContain("Yule Guttenbeil");
    expect(staged.images[0]?.bytes.toString()).toBe("png");
    const hosted = embedSignatureImages(
      '<img src="cid:attune-logo@01DC">',
      [
        {
          contentId: "attune-logo",
          contentType: "image/png",
          bytes: Buffer.from("png"),
        },
      ],
    );
    expect(hosted).toContain("data:image/png;base64,cG5n");
  });

  it("strips scripts before the signature is saved", () => {
    const clean = sanitizeStoredSignatureHtml(
      '<div id="Signature" onclick="alert(1)">Yule<script>alert(1)</script></div>',
    );
    expect(clean).toContain("Yule");
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("onclick");
  });
});

describe("referencedContentIds", () => {
  it("collects cid image identifiers", () => {
    expect(
      referencedContentIds('<img src="cid:attune-logo"><img src="cid:other@host">'),
    ).toEqual(["attune-logo", "other@host"]);
  });
});
