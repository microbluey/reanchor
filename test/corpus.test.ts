import { describe, expect, it } from "vitest";

import { buildCorpus } from "../bench/corpus.js";
import { DOCUMENTS } from "../bench/documents.js";
import { describeQuote } from "../src/describe.js";
import { resolveQuote } from "../src/resolve.js";

/**
 * The corpus as a regression gate.
 *
 * `npm run bench` prints the table for a human; this asserts the floors so
 * that a change which trades correctness for recall fails CI. The thresholds
 * are set just below currently measured values, so they catch regressions
 * without needing an update on every improvement.
 */
describe("corpus", () => {
  const cases = buildCorpus(DOCUMENTS);

  it("covers every mutation class over every document", () => {
    expect(cases.length).toBeGreaterThan(200);
    const mutations = new Set(cases.map((testCase) => testCase.mutation));
    expect(mutations.size).toBe(12);
  });

  it("meets the accuracy floors", () => {
    let resolvable = 0;
    let found = 0;
    let exact = 0;
    let mislocated = 0;
    let deleted = 0;
    let refused = 0;

    for (const testCase of cases) {
      const selector = describeQuote(testCase.original, testCase.span.start, testCase.span.end);
      const resolved = resolveQuote(testCase.mutated, selector);

      if (testCase.expected === null) {
        deleted++;
        if (resolved === null) refused++;
        continue;
      }

      resolvable++;
      if (resolved === null) continue;
      found++;
      if (resolved.start === testCase.expected.start && resolved.end === testCase.expected.end) {
        exact++;
      } else if (resolved.start >= testCase.expected.end || testCase.expected.start >= resolved.end) {
        mislocated++;
      }
    }

    expect(found / resolvable).toBeGreaterThanOrEqual(0.97);
    expect(exact / resolvable).toBeGreaterThanOrEqual(0.97);
    // The number that actually hurts users: a match pointing somewhere else.
    expect(mislocated / found).toBeLessThanOrEqual(0.01);
    expect(refused / deleted).toBeGreaterThanOrEqual(0.9);
  });

  it("never mislocates when the passage is unchanged", () => {
    for (const testCase of cases) {
      if (testCase.mutation !== "edit-outside-span") continue;
      const selector = describeQuote(testCase.original, testCase.span.start, testCase.span.end);
      const resolved = resolveQuote(testCase.mutated, selector);
      expect(resolved?.start).toBe(testCase.expected?.start);
      expect(resolved?.end).toBe(testCase.expected?.end);
    }
  });

  it("is deterministic across runs", () => {
    const again = buildCorpus(DOCUMENTS);
    expect(again.map((testCase) => testCase.mutated)).toEqual(cases.map((testCase) => testCase.mutated));
  });

  it("resolves at a workable rate", () => {
    const prepared = cases.map((testCase) => ({
      testCase,
      selector: describeQuote(testCase.original, testCase.span.start, testCase.span.end),
    }));
    const started = process.hrtime.bigint();
    for (const { testCase, selector } of prepared) resolveQuote(testCase.mutated, selector);
    const perCaseMs = Number(process.hrtime.bigint() - started) / 1e6 / prepared.length;
    expect(perCaseMs).toBeLessThan(10);
  });
});
