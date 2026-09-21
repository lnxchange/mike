import { describe, expect, it } from "vitest";
import {
  appendOutlookSignature,
  extractOutlookSignatureHtml,
  outlookInnerHtmlFromDraftBody,
  referencedContentIds,
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

describe("referencedContentIds", () => {
  it("collects cid image identifiers", () => {
    expect(
      referencedContentIds('<img src="cid:attune-logo"><img src="cid:other@host">'),
    ).toEqual(["attune-logo", "other@host"]);
  });
});
