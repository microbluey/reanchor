import { describe, expect, it } from "vitest";

import { buildGramIndex, findApproximate, findExact } from "../src/search.js";

describe("findExact", () => {
  it("finds every occurrence left to right", () => {
    expect(findExact("abcabcabc", "abc")).toEqual([0, 3, 6]);
  });

  it("finds overlapping occurrences", () => {
    expect(findExact("aaaa", "aa")).toEqual([0, 1, 2]);
  });

  it("returns nothing for an empty needle", () => {
    expect(findExact("abc", "")).toEqual([]);
  });
});

describe("findApproximate", () => {
  const haystack =
    "the quick brown fox jumps over the lazy dog while the slow green turtle watches from the riverbank";

  it("finds an exact occurrence at distance zero", () => {
    const [match] = findApproximate(haystack, "brown fox jumps");
    expect(match).toBeDefined();
    expect(match?.distance).toBe(0);
    expect(haystack.slice(match?.start, match?.end)).toBe("brown fox jumps");
  });

  it("tolerates a substitution", () => {
    const [match] = findApproximate(haystack, "brown fix jumps");
    expect(match?.distance).toBe(1);
    expect(haystack.slice(match?.start, match?.end)).toBe("brown fox jumps");
  });

  it("tolerates a deletion", () => {
    const [match] = findApproximate(haystack, "brown fox jums");
    expect(match?.distance).toBe(1);
    expect(haystack.slice(match?.start, match?.end)).toBe("brown fox jumps");
  });

  it("tolerates an insertion", () => {
    const [match] = findApproximate(haystack, "brown foxx jumps");
    expect(match?.distance).toBe(1);
    expect(haystack.slice(match?.start, match?.end)).toBe("brown fox jumps");
  });

  it("does not let the alignment run past the quote", () => {
    // Sellers' free end gaps are the point: the window must not swell to the
    // whole seeded region just because the region is long.
    const [match] = findApproximate(haystack, "lazy dog");
    expect(haystack.slice(match?.start, match?.end)).toBe("lazy dog");
  });

  it("rejects a needle that is not present", () => {
    expect(findApproximate(haystack, "electromagnetic interference pattern")).toEqual([]);
  });

  it("respects maxEditRatio", () => {
    expect(findApproximate(haystack, "brown cat leaps", { maxEditRatio: 0.05 })).toEqual([]);
    expect(findApproximate(haystack, "brown fix jumps", { maxEditRatio: 0.05 })).not.toEqual([]);
  });

  it("reports distinct occurrences rather than neighbouring alignments", () => {
    const repeated = "alpha beta gamma. filler filler filler. alpha beta gamma.";
    const matches = findApproximate(repeated, "alpha beta gamma");
    expect(matches).toHaveLength(2);
    expect(matches.map((match) => match.start).sort((a, b) => a - b)).toEqual([
      repeated.indexOf("alpha"),
      repeated.lastIndexOf("alpha"),
    ]);
  });

  it("orders results by increasing distance", () => {
    const text = "alpha beta gamma ... filler ... alpha beto gamma";
    const matches = findApproximate(text, "alpha beta gamma");
    expect(matches[0]?.distance).toBe(0);
    expect(matches[1]?.distance).toBe(1);
  });

  it("finds a needle shorter than one seed by falling back to full alignment", () => {
    const [match] = findApproximate("xxx abc xxx", "ab");
    expect(match).toBeDefined();
    expect("xxx abc xxx".slice(match?.start, match?.end)).toBe("ab");
  });

  it("returns nothing for empty input", () => {
    expect(findApproximate("", "abc")).toEqual([]);
    expect(findApproximate("abc", "")).toEqual([]);
  });

  it("gives the same answer with a prebuilt index", () => {
    const index = buildGramIndex(haystack);
    expect(findApproximate(haystack, "brown fix jumps", { index })).toEqual(
      findApproximate(haystack, "brown fix jumps"),
    );
  });

  it("still finds a quote whose common seeds are saturated", () => {
    // ' the ' appears far more than MAX_POSTINGS times, so the seed index
    // must not be the only route to a match.
    const filler = "the the the the the the the ".repeat(200);
    const text = `${filler}distinctive marker sentence here${filler}`;
    const [match] = findApproximate(text, "distinctive marker sentence here");
    expect(match?.distance).toBe(0);
  });

  it("scales to a long document without scanning it quadratically", () => {
    const paragraph = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod. ";
    const text = paragraph.repeat(4000) + "the needle we are looking for is right here";
    const started = process.hrtime.bigint();
    const [match] = findApproximate(text, "the needle we are lokoing for is right here");
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(match).toBeDefined();
    expect(match?.distance).toBeLessThanOrEqual(2);
    expect(elapsedMs).toBeLessThan(1000);
  });
});
