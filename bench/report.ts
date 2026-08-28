/**
 * Scoring and formatting shared by the benchmark and the head-to-head
 * comparison, so the two tables mean the same thing.
 *
 * Three numbers matter, and they are not the same number:
 *
 *   recall      — of the cases where the passage still exists, how many were
 *                 found at all.
 *   mislocated  — of the cases where a match was returned, how many pointed
 *                 somewhere other than the truth. This is the number that
 *                 actually hurts users, because a mislocated citation looks
 *                 verified.
 *   refusals    — of the cases where the passage was deleted, how many
 *                 correctly returned nothing.
 *
 * A library optimizing recall alone can score 100% by returning its best guess
 * always, at the cost of mislocating everything it cannot find. Reporting the
 * three separately makes that trade visible.
 */

import type { Case } from "./corpus.js";

/** A span, as any implementation under comparison reports one. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface Tally {
  resolvable: number;
  found: number;
  exactSpan: number;
  overlapping: number;
  mislocated: number;
  deleted: number;
  refused: number;
  elapsedMs: number;
}

export function emptyTally(): Tally {
  return {
    resolvable: 0,
    found: 0,
    exactSpan: 0,
    overlapping: 0,
    mislocated: 0,
    deleted: 0,
    refused: 0,
    elapsedMs: 0,
  };
}

export function addTally(total: Tally, tally: Tally): void {
  total.resolvable += tally.resolvable;
  total.found += tally.found;
  total.exactSpan += tally.exactSpan;
  total.overlapping += tally.overlapping;
  total.mislocated += tally.mislocated;
  total.deleted += tally.deleted;
  total.refused += tally.refused;
  total.elapsedMs += tally.elapsedMs;
}

/** How many cases this tally covers, resolvable and deleted together. */
export function caseCount(tally: Tally): number {
  return tally.resolvable + tally.deleted;
}

/**
 * Record one case's outcome. `resolved` is whatever the implementation
 * returned, `null` meaning it declined to answer.
 */
export function score(tally: Tally, testCase: Case, resolved: Span | null): void {
  if (testCase.expected === null) {
    tally.deleted++;
    if (resolved === null) tally.refused++;
    return;
  }

  tally.resolvable++;
  if (resolved === null) return;
  tally.found++;

  const exact =
    resolved.start === testCase.expected.start && resolved.end === testCase.expected.end;
  const overlaps = resolved.start < testCase.expected.end && testCase.expected.start < resolved.end;
  if (exact) tally.exactSpan++;
  else if (overlaps) tally.overlapping++;
  else tally.mislocated++;
}

export function percent(numerator: number, denominator: number): string {
  if (denominator === 0) return "    —";
  return `${((numerator / denominator) * 100).toFixed(1).padStart(5)}%`;
}

/** The four accuracy columns, in the order every table here prints them. */
export function accuracyColumns(tally: Tally): string[] {
  return [
    percent(tally.found, tally.resolvable),
    percent(tally.exactSpan, tally.resolvable),
    percent(tally.overlapping, tally.resolvable),
    percent(tally.mislocated, tally.found),
    percent(tally.refused, tally.deleted),
  ];
}

/** Microseconds per case, or an em dash where there were none. */
export function microsPerCase(tally: Tally): string {
  const n = caseCount(tally);
  return n === 0 ? "—" : ((tally.elapsedMs * 1000) / n).toFixed(0);
}

/** Group cases by mutation, preserving the order the corpus generated them. */
export function tallyByMutation(cases: readonly Case[]): Map<string, Tally> {
  const byMutation = new Map<string, Tally>();
  for (const testCase of cases) {
    if (!byMutation.has(testCase.mutation)) byMutation.set(testCase.mutation, emptyTally());
  }
  return byMutation;
}
