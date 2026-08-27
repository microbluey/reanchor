/**
 * Run the corpus and report per-mutation accuracy.
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

import { describeQuote } from "../src/describe.js";
import { resolveQuote } from "../src/resolve.js";
import { buildCorpus, type Case } from "./corpus.js";
import { DOCUMENTS } from "./documents.js";

interface Tally {
  resolvable: number;
  found: number;
  exactSpan: number;
  overlapping: number;
  mislocated: number;
  deleted: number;
  refused: number;
  elapsedMs: number;
}

function emptyTally(): Tally {
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

function run(cases: readonly Case[]): Map<string, Tally> {
  const byMutation = new Map<string, Tally>();

  for (const testCase of cases) {
    const tally = byMutation.get(testCase.mutation) ?? emptyTally();
    byMutation.set(testCase.mutation, tally);

    const selector = describeQuote(testCase.original, testCase.span.start, testCase.span.end);
    const started = process.hrtime.bigint();
    const resolved = resolveQuote(testCase.mutated, selector);
    tally.elapsedMs += Number(process.hrtime.bigint() - started) / 1e6;

    if (testCase.expected === null) {
      tally.deleted++;
      if (resolved === null) tally.refused++;
      continue;
    }

    tally.resolvable++;
    if (resolved === null) continue;
    tally.found++;

    const exact = resolved.start === testCase.expected.start && resolved.end === testCase.expected.end;
    const overlaps =
      resolved.start < testCase.expected.end && testCase.expected.start < resolved.end;
    if (exact) tally.exactSpan++;
    else if (overlaps) tally.overlapping++;
    else tally.mislocated++;
  }

  return byMutation;
}

function percent(numerator: number, denominator: number): string {
  if (denominator === 0) return "    —";
  return `${((numerator / denominator) * 100).toFixed(1).padStart(5)}%`;
}

const cases = buildCorpus(DOCUMENTS);
const byMutation = run(cases);

const header = [
  "mutation".padEnd(24),
  "n".padStart(5),
  "recall".padStart(7),
  "exact".padStart(7),
  "overlap".padStart(8),
  "wrong".padStart(7),
  "refused".padStart(8),
  "µs/case".padStart(9),
].join(" ");

console.log(`reanchor benchmark — ${cases.length} cases over ${DOCUMENTS.length} documents\n`);
console.log(header);
console.log("-".repeat(header.length));

const total = emptyTally();
for (const [mutation, tally] of byMutation) {
  const n = tally.resolvable + tally.deleted;
  console.log(
    [
      mutation.padEnd(24),
      String(n).padStart(5),
      percent(tally.found, tally.resolvable),
      percent(tally.exactSpan, tally.resolvable),
      percent(tally.overlapping, tally.resolvable),
      percent(tally.mislocated, tally.found),
      percent(tally.refused, tally.deleted),
      (n === 0 ? "—" : ((tally.elapsedMs * 1000) / n).toFixed(0)).padStart(9),
    ].join(" "),
  );

  total.resolvable += tally.resolvable;
  total.found += tally.found;
  total.exactSpan += tally.exactSpan;
  total.overlapping += tally.overlapping;
  total.mislocated += tally.mislocated;
  total.deleted += tally.deleted;
  total.refused += tally.refused;
  total.elapsedMs += tally.elapsedMs;
}

const n = total.resolvable + total.deleted;
console.log("-".repeat(header.length));
console.log(
  [
    "all".padEnd(24),
    String(n).padStart(5),
    percent(total.found, total.resolvable),
    percent(total.exactSpan, total.resolvable),
    percent(total.overlapping, total.resolvable),
    percent(total.mislocated, total.found),
    percent(total.refused, total.deleted),
    ((total.elapsedMs * 1000) / n).toFixed(0).padStart(9),
  ].join(" "),
);
