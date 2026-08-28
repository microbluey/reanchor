import { describe, expect, it } from "vitest";

import { describeQuote } from "../src/describe.js";
import { prepareDocument, resolveQuote, resolveQuotes } from "../src/resolve.js";

const ARTICLE = [
  "# Robust anchoring",
  "",
  "Annotations are stored apart from the documents they describe. When the",
  "document changes, every stored offset silently rots: the highlight still",
  "renders, but over the wrong words.",
  "",
  "## Why offsets rot",
  "",
  "A position selector is a promise about a byte layout, and byte layouts are",
  "not stable across a re-export, a CMS migration, or a second pass of OCR.",
  "",
  "## What survives",
  "",
  "Quoted text plus a little context survives most of these changes, because",
  "it describes the passage rather than its coordinates.",
].join("\n");

describe("resolveQuote", () => {
  it("finds an unchanged quote exactly", () => {
    const result = resolveQuote(ARTICLE, { exact: "every stored offset silently rots" });
    expect(result).not.toBeNull();
    expect(result?.method).toBe("exact");
    expect(result?.confidence).toBe(1);
    expect(result?.distance).toBe(0);
    expect(ARTICLE.slice(result?.start, result?.end)).toBe("every stored offset silently rots");
  });

  it("prefers the occurrence whose context agrees", () => {
    const document = "the cat sat on the mat. the dog sat on the rug.";
    const result = resolveQuote(document, {
      exact: "sat on the",
      prefix: "the dog ",
      suffix: " rug",
    });
    expect(result?.method).toBe("exact-with-context");
    expect(result?.start).toBe(document.lastIndexOf("sat on the"));
    expect(result?.rivals).toEqual([]);
  });

  it("reports rivals when a repeated quote has no context to separate them", () => {
    const document = "the cat sat on the mat. the dog sat on the rug.";
    const result = resolveQuote(document, { exact: "sat on the" });
    expect(result).not.toBeNull();
    expect(result?.rivals).toHaveLength(1);
    expect(result?.confidence).toBeLessThan(1);
  });

  it("survives re-typeset whitespace", () => {
    const reflowed = ARTICLE.replace(/\n/g, " ").replace(/ {2,}/g, " ");
    const result = resolveQuote(reflowed, {
      exact: "the highlight still\nrenders, but over the wrong words",
    });
    expect(result?.method).toBe("normalized");
    expect(result?.distance).toBe(0);
    expect(reflowed.slice(result?.start, result?.end)).toBe(
      "the highlight still renders, but over the wrong words",
    );
  });

  it("survives typographic substitution", () => {
    const document = 'She called it a “promise about a byte layout”—her words.';
    const result = resolveQuote(document, { exact: '"promise about a byte layout"' });
    expect(result?.method).toBe("normalized");
    expect(document.slice(result?.start, result?.end)).toBe("“promise about a byte layout”");
  });

  it("survives a hyphenated line break introduced by re-typesetting", () => {
    const document = "not stable across a re-export, a CMS mi-\ngration, or a second pass of OCR.";
    const result = resolveQuote(document, { exact: "a CMS migration" });
    expect(result?.method).toBe("normalized");
    expect(document.slice(result?.start, result?.end)).toBe("a CMS mi-\ngration");
  });

  it("survives a genuine edit inside the quote", () => {
    const edited = ARTICLE.replace("silently rots", "quietly rots");
    const result = resolveQuote(edited, { exact: "every stored offset silently rots" });
    expect(result?.method).toBe("approximate");
    expect(result?.distance).toBeGreaterThan(0);
    expect(edited.slice(result?.start, result?.end)).toContain("quietly rots");
  });

  it("survives OCR noise", () => {
    const scanned = ARTICLE.replace("byte layouts are", "byte 1ayouts arc");
    const result = resolveQuote(scanned, {
      exact: "a promise about a byte layout, and byte layouts are",
    });
    expect(result).not.toBeNull();
    expect(result?.confidence).toBeGreaterThan(0.6);
    expect(scanned.slice(result?.start, result?.end)).toContain("byte 1ayouts arc");
  });

  it("returns null when the passage was deleted", () => {
    const result = resolveQuote(ARTICLE, {
      exact: "a paragraph that was never in this document at all, about turbines",
    });
    expect(result).toBeNull();
  });

  it("returns null rather than the least-bad window", () => {
    // Half the words are shared with the document, which is exactly the case
    // where a resolver without a floor would return something confident and
    // wrong.
    const result = resolveQuote(
      ARTICLE,
      { exact: "every stored turbine violently ignites" },
      { minConfidence: 0.5 },
    );
    expect(result).toBeNull();
  });

  it("degrades confidence as the quote degrades", () => {
    const quote = "A position selector is a promise about a byte layout";
    const clean = resolveQuote(ARTICLE, { exact: quote });
    const noisy = resolveQuote(ARTICLE.replace("promise", "promlse"), { exact: quote });
    const noisier = resolveQuote(ARTICLE.replace("promise about a byte", "promlse aboot a byfe"), {
      exact: quote,
    });
    expect(clean?.confidence).toBeGreaterThan(noisy?.confidence as number);
    expect(noisy?.confidence).toBeGreaterThan(noisier?.confidence as number);
  });

  it("penalizes a match whose context did not survive", () => {
    const document = "alpha. the quoted passage. omega.";
    const agreeing = resolveQuote(document, {
      exact: "the quoted passage",
      prefix: "alpha. ",
    });
    const disagreeing = resolveQuote(document, {
      exact: "the quoted passage",
      prefix: "completely different lead-in ",
    });
    expect(agreeing?.confidence).toBeGreaterThan(disagreeing?.confidence as number);
    expect(disagreeing).not.toBeNull();
  });

  it("honours maxMethod so callers can demand certainty", () => {
    const edited = ARTICLE.replace("silently rots", "quietly rots");
    const selector = { exact: "every stored offset silently rots" };
    expect(resolveQuote(edited, selector)).not.toBeNull();
    expect(resolveQuote(edited, selector, { maxMethod: "normalized" })).toBeNull();
  });

  it("respects minConfidence", () => {
    const edited = ARTICLE.replace("silently rots", "quietly rots");
    const selector = { exact: "every stored offset silently rots" };
    expect(resolveQuote(edited, selector, { minConfidence: 0.5 })).not.toBeNull();
    expect(resolveQuote(edited, selector, { minConfidence: 0.99 })).toBeNull();
  });

  it("returns null for an empty quote", () => {
    expect(resolveQuote(ARTICLE, { exact: "" })).toBeNull();
  });

  it("returns null for an empty document", () => {
    expect(resolveQuote("", { exact: "anything" })).toBeNull();
  });

  it("resolves a quote that spans the whole document", () => {
    const result = resolveQuote(ARTICLE, { exact: ARTICLE });
    expect(result?.start).toBe(0);
    expect(result?.end).toBe(ARTICLE.length);
  });

  it("gives the same answer for a prepared document", () => {
    const prepared = prepareDocument(ARTICLE);
    const selector = { exact: "every stored offset silently rots" };
    expect(resolveQuote(prepared, selector)).toEqual(resolveQuote(ARTICLE, selector));
  });

  it("resolves many quotes in one pass", () => {
    const results = resolveQuotes(ARTICLE, [
      { exact: "Robust anchoring" },
      { exact: "not present in this text whatsoever, about turbines" },
      { exact: "it describes the passage rather than its coordinates" },
    ]);
    expect(results.map((result) => result !== null)).toEqual([true, false, true]);
  });
});

describe("describeQuote", () => {
  it("records context even for a quote that is unique today", () => {
    const selector = describeQuote(ARTICLE, 2, 18);
    expect(selector.exact).toBe("Robust anchoring");
    // Uniqueness at capture time does not survive editing, so the evidence that
    // would tell a revised passage from a stale verbatim copy is kept anyway.
    expect(selector.suffix).not.toBe("");
  });

  it("prefers a revised passage over a stale verbatim copy of it", () => {
    // hypothesis/client#7571: the quote is unique when recorded, an editor later
    // revises it, and an untouched copy survives elsewhere as a pull quote.
    const at = ARTICLE.indexOf("it describes the passage rather than its coordinates");
    const quoted = "it describes the passage rather than its coordinates";
    const selector = describeQuote(ARTICLE, at, at + quoted.length);

    const revised = "it describes this passage rather than its coordinates";
    const edited = `${ARTICLE.slice(0, at)}${revised}${ARTICLE.slice(at + quoted.length)}`;
    const withDecoy = `${edited}\n\nPreviously published: ${quoted}`;

    const resolved = resolveQuote(withDecoy, selector);
    expect(resolved?.start).toBe(at);
    expect(resolved?.text).toBe(revised);
  });

  it("grows context until a repeated quote is unique", () => {
    const document = "the cat sat on the mat. the dog sat on the rug.";
    const at = document.lastIndexOf("sat on the");
    const selector = describeQuote(document, at, at + "sat on the".length);
    expect(selector.prefix).not.toBe("");
    const resolved = resolveQuote(document, selector);
    expect(resolved?.start).toBe(at);
    expect(resolved?.rivals).toEqual([]);
  });

  it("stops growing at maxContextLength when a passage truly repeats", () => {
    const half = "identical paragraph text repeated verbatim. ";
    const document = half + half;
    const selector = describeQuote(document, half.length, document.length, {
      maxContextLength: 32,
    });
    expect((selector.prefix as string).length).toBeLessThanOrEqual(32);
  });

  it("round-trips through resolveQuote for every sentence of the article", () => {
    for (const sentence of ARTICLE.split(/(?<=\.)\s+/)) {
      const at = ARTICLE.indexOf(sentence);
      const selector = describeQuote(ARTICLE, at, at + sentence.length);
      const resolved = resolveQuote(ARTICLE, selector);
      expect(resolved?.start).toBe(at);
      expect(resolved?.end).toBe(at + sentence.length);
      expect(resolved?.confidence).toBe(1);
    }
  });

  it("round-trips after the document is re-typeset", () => {
    const sentence = "Quoted text plus a little context survives most of these changes";
    const at = ARTICLE.indexOf(sentence.split("\n")[0] as string);
    const selector = describeQuote(ARTICLE, at, at + sentence.length);
    const reflowed = ARTICLE.replace(/\n/g, " ").replace(/ {2,}/g, " ");
    const resolved = resolveQuote(reflowed, selector);
    expect(resolved).not.toBeNull();
    expect(reflowed.slice(resolved?.start, resolved?.end)).toContain("Quoted text plus a little");
  });

  it("describes an empty span with context on both sides", () => {
    const selector = describeQuote(ARTICLE, 20, 20);
    expect(selector.exact).toBe("");
    expect(selector.prefix).not.toBe("");
    expect(selector.suffix).not.toBe("");
  });

  it("rejects a span outside the document", () => {
    expect(() => describeQuote(ARTICLE, 0, ARTICLE.length + 1)).toThrow(RangeError);
    expect(() => describeQuote(ARTICLE, 5, 4)).toThrow(RangeError);
  });
});
