/**
 * Run the corpus and report per-mutation accuracy.
 *
 * The three columns that matter, and why they are three columns rather than
 * one, are documented in `report.ts` alongside the scoring.
 *
 * `compare.ts` runs the same corpus through `dom-anchor-text-quote` as well,
 * for the same numbers side by side.
 */

import { describeQuote } from "../src/describe.js";
import { resolveQuote } from "../src/resolve.js";
import { buildCorpus, type Case } from "./corpus.js";
import { DOCUMENTS } from "./documents.js";
import {
  accuracyColumns,
  addTally,
  caseCount,
  emptyTally,
  microsPerCase,
  score,
  tallyByMutation,
  type Tally,
} from "./report.js";

function run(cases: readonly Case[]): Map<string, Tally> {
  const byMutation = tallyByMutation(cases);

  for (const testCase of cases) {
    const tally = byMutation.get(testCase.mutation) as Tally;

    const selector = describeQuote(testCase.original, testCase.span.start, testCase.span.end);
    const started = process.hrtime.bigint();
    const resolved = resolveQuote(testCase.mutated, selector);
    tally.elapsedMs += Number(process.hrtime.bigint() - started) / 1e6;

    score(tally, testCase, resolved);
  }

  return byMutation;
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
  console.log(
    [
      mutation.padEnd(24),
      String(caseCount(tally)).padStart(5),
      ...accuracyColumns(tally),
      microsPerCase(tally).padStart(9),
    ].join(" "),
  );
  addTally(total, tally);
}

console.log("-".repeat(header.length));
console.log(
  [
    "all".padEnd(24),
    String(caseCount(total)).padStart(5),
    ...accuracyColumns(total),
    microsPerCase(total).padStart(9),
  ].join(" "),
);
