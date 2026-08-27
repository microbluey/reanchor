import { describe, expect, it } from "vitest";

import { normalize, toSourceSpan } from "../src/normalize.js";

/**
 * The offset map is the load-bearing part of this module: a resolver that
 * matches on normalized text but reports offsets into it produces citations
 * that highlight the wrong characters. So most of these tests assert on
 * `toSourceSpan` round-trips rather than on the normalized string alone.
 */
describe("normalize", () => {
  it("collapses whitespace runs to a single space", () => {
    expect(normalize("a  \n\t b").text).toBe("a b");
  });

  it("maps a collapsed run back to the whole run", () => {
    const source = "a  \n\t b";
    const normalized = normalize(source);
    const space = normalized.text.indexOf(" ");
    expect(toSourceSpan(normalized, space, space + 1)).toEqual({ start: 1, end: 6 });
  });

  it("trims the ends without shifting interior offsets", () => {
    const source = "   hello world   ";
    const normalized = normalize(source);
    expect(normalized.text).toBe("hello world");
    expect(toSourceSpan(normalized, 0, 5)).toEqual({ start: 3, end: 8 });
    expect(source.slice(3, 8)).toBe("hello");
  });

  it("folds typographic quotes and dashes to ASCII", () => {
    expect(normalize("“wait—no”, she said’s").text).toBe('"wait-no", she said\'s');
  });

  it("expands the ellipsis so that … and ... converge", () => {
    expect(normalize("wait…").text).toBe(normalize("wait...").text);
  });

  it("maps every character of a multi-character fold to the one source point", () => {
    const normalized = normalize("a…b");
    expect(normalized.text).toBe("a...b");
    // All three dots came from the single ellipsis at source index 1.
    expect(toSourceSpan(normalized, 1, 4)).toEqual({ start: 1, end: 2 });
    expect(toSourceSpan(normalized, 2, 3)).toEqual({ start: 1, end: 2 });
  });

  it("strips combining marks left by decomposition", () => {
    expect(normalize("café").text).toBe("cafe");
    expect(normalize("café").text).toBe("cafe");
  });

  it("folds compatibility forms", () => {
    expect(normalize("Ｈｅｌｌｏ").text).toBe("hello");
    expect(normalize("ﬁne").text).toBe("fine");
  });

  it("drops zero-width characters, including the soft hyphen", () => {
    expect(normalize("a​b­c﻿d").text).toBe("abcd");
  });

  it("joins words broken across a line by a hyphen", () => {
    expect(normalize("exam-\nple").text).toBe("example");
    expect(normalize("exam-\r\n   ple").text).toBe("example");
  });

  it("keeps a hyphen that is not a line break", () => {
    expect(normalize("well-known").text).toBe("well-known");
    expect(normalize("exam- ple").text).toBe("exam- ple");
  });

  it("keeps a trailing hyphen at the very end of the text", () => {
    expect(normalize("exam-\n").text).toBe("exam-");
  });

  it("keeps a hyphen before a line break that resumes with punctuation", () => {
    expect(normalize("exam-\n(ple)").text).toBe("exam- (ple)");
  });

  it("maps the joined halves back to their own source ranges", () => {
    const source = "exam-\nple done";
    const normalized = normalize(source);
    expect(normalized.text).toBe("example done");
    expect(toSourceSpan(normalized, 0, 7)).toEqual({ start: 0, end: 9 });
    expect(source.slice(0, 9)).toBe("exam-\nple");
  });

  it("maps every single normalized character to a non-empty source range", () => {
    const source = "  A­“B—c… \n dｅf  ";
    const normalized = normalize(source);
    for (let i = 0; i < normalized.text.length; i++) {
      const span = toSourceSpan(normalized, i, i + 1);
      expect(span.end).toBeGreaterThan(span.start);
      expect(span.start).toBeGreaterThanOrEqual(0);
      expect(span.end).toBeLessThanOrEqual(source.length);
    }
  });

  it("produces monotonically non-decreasing source offsets", () => {
    const normalized = normalize("The “quick” brown—fox jumps\nover  the lazy dog.");
    for (let i = 1; i < normalized.text.length; i++) {
      expect(normalized.srcStart[i] as number).toBeGreaterThanOrEqual(normalized.srcStart[i - 1] as number);
      expect(normalized.srcEnd[i] as number).toBeGreaterThanOrEqual(normalized.srcEnd[i - 1] as number);
    }
  });

  it("handles astral characters without splitting surrogate pairs", () => {
    const source = "a\u{1f600}b";
    const normalized = normalize(source);
    const emoji = normalized.text.indexOf("\u{1f600}");
    expect(emoji).toBeGreaterThan(-1);
    expect(toSourceSpan(normalized, emoji, emoji + 2)).toEqual({ start: 1, end: 3 });
  });

  it("respects disabled options", () => {
    expect(normalize("A  B", { caseFold: false }).text).toBe("A B");
    expect(normalize("A  B", { collapseWhitespace: false }).text).toBe("a  b");
    expect(normalize(" ab ", { trim: false }).text).toBe(" ab ");
    expect(normalize("café", { stripMarks: false }).text).toBe("café");
    expect(normalize("a—b", { foldPunctuation: false }).text).toBe("a—b");
  });

  it("returns an empty result for whitespace-only input", () => {
    const normalized = normalize("   \n  ");
    expect(normalized.text).toBe("");
    expect(toSourceSpan(normalized, 0, 0)).toEqual({ start: 6, end: 6 });
  });

  it("collapses an empty span to the start of its character", () => {
    const normalized = normalize("  hello");
    expect(toSourceSpan(normalized, 1, 1)).toEqual({ start: 3, end: 3 });
  });

  it("rejects spans outside the normalized text", () => {
    const normalized = normalize("hello");
    expect(() => toSourceSpan(normalized, 0, 6)).toThrow(RangeError);
    expect(() => toSourceSpan(normalized, 3, 2)).toThrow(RangeError);
    expect(() => toSourceSpan(normalized, -1, 1)).toThrow(RangeError);
  });

  it("is idempotent", () => {
    const once = normalize("The “quick—brown” fox… café  \n jumps").text;
    expect(normalize(once).text).toBe(once);
  });
});
