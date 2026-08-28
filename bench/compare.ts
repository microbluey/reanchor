/**
 * Run the same corpus through this library and through
 * `dom-anchor-text-quote`, and report both.
 *
 * Why compare against that one: it is what callers already have. 4.0.2 was
 * published in February 2017, it is the anchoring layer under Hypothesis-era
 * annotation tools, and it still does tens of thousands of npm downloads a
 * month. Anyone who could adopt this library is choosing between the two, so
 * the useful claim is not "we score well" but "here is where the two differ,
 * on cases neither of us hand-picked".
 *
 * Both implementations get the same document, the same span, and their own
 * describe step — comparing this library's resolver against the incumbent's
 * 32-character context window would be comparing halves of two different
 * designs. Each records a selector the way it would in production, then
 * resolves it against the mutated document.
 *
 * The incumbent is reported twice, because it searches outward from a position
 * and a caller who stored a selector has usually stored an offset beside it.
 * Withholding that would be measuring it doing something nobody asks it to do:
 * `+hint` passes the offset recorded at capture time, stale by whatever the
 * edit shifted, which is the best a real caller has. It is the fairer of the
 * two rows and it is the one to read.
 *
 * The corpus is ours, which is the honest caveat: it is mechanically labelled
 * and reproducible, but we chose the mutation classes, and they are the classes
 * this library was built for. Read the per-class rows rather than the total.
 * `refused` is the column we lose.
 */

import { fromTextPosition, toTextPosition } from "dom-anchor-text-quote";

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
  type Span,
  type Tally,
} from "./report.js";

/**
 * One implementation, as the comparison sees it: record a selector against the
 * original, then find it in the mutated document. The selector type is opaque
 * because the two libraries' selectors are not the same type — only the round
 * trip is comparable.
 */
interface Implementation {
  readonly name: string;
  readonly run: (testCase: Case) => Span | null;
}

const REANCHOR: Implementation = {
  name: "reanchor",
  run: (testCase) => {
    const selector = describeQuote(testCase.original, testCase.span.start, testCase.span.end);
    return resolveQuote(testCase.mutated, selector);
  },
};

/**
 * `hint` is what the caller would pass, or undefined for none. The incumbent
 * reads only `textContent`, so it runs against a string without a DOM.
 */
function domAnchor(name: string, hint: (testCase: Case) => number | undefined): Implementation {
  return {
    name,
    run: (testCase) => {
      const selector = fromTextPosition({ textContent: testCase.original }, testCase.span);
      const at = hint(testCase);
      return toTextPosition(
        { textContent: testCase.mutated },
        selector,
        at === undefined ? {} : { hint: at },
      );
    },
  };
}

const IMPLEMENTATIONS = [
  domAnchor("dom-anchor", () => undefined),
  // The offset stored at capture time. Every mutation here moves it, which is
  // the point — a hint is a guess about where the passage used to be.
  domAnchor("dom-anchor+hint", (testCase) => testCase.span.start),
  REANCHOR,
];

function run(implementation: Implementation, cases: readonly Case[]): Map<string, Tally> {
  const byMutation = tallyByMutation(cases);

  for (const testCase of cases) {
    const tally = byMutation.get(testCase.mutation) as Tally;
    const started = process.hrtime.bigint();
    const resolved = implementation.run(testCase);
    tally.elapsedMs += Number(process.hrtime.bigint() - started) / 1e6;
    score(tally, testCase, resolved);
  }

  return byMutation;
}

const cases = buildCorpus(DOCUMENTS);
const results = IMPLEMENTATIONS.map((implementation) => ({
  implementation,
  byMutation: run(implementation, cases),
}));

const WIDEST_NAME = Math.max(...IMPLEMENTATIONS.map((i) => i.name.length));

const header = [
  "mutation".padEnd(22),
  "n".padStart(4),
  "impl".padEnd(WIDEST_NAME),
  "recall".padStart(7),
  "exact".padStart(7),
  "overlap".padStart(8),
  "wrong".padStart(7),
  "refused".padStart(8),
  "µs/case".padStart(9),
].join(" ");

console.log(
  `head to head — ${cases.length} cases over ${DOCUMENTS.length} documents, ` +
    "each implementation using its own describe step\n",
);
console.log(header);
console.log("-".repeat(header.length));

const totals = IMPLEMENTATIONS.map(() => emptyTally());

for (const mutation of results[0]?.byMutation.keys() ?? []) {
  results.forEach(({ implementation, byMutation }, index) => {
    const tally = byMutation.get(mutation) as Tally;
    addTally(totals[index] as Tally, tally);
    console.log(
      [
        (index === 0 ? mutation : "").padEnd(22),
        (index === 0 ? String(caseCount(tally)) : "").padStart(4),
        implementation.name.padEnd(WIDEST_NAME),
        ...accuracyColumns(tally),
        microsPerCase(tally).padStart(9),
      ].join(" "),
    );
  });
}

console.log("-".repeat(header.length));

results.forEach(({ implementation }, index) => {
  const total = totals[index] as Tally;
  console.log(
    [
      (index === 0 ? "all" : "").padEnd(22),
      (index === 0 ? String(caseCount(total)) : "").padStart(4),
      implementation.name.padEnd(WIDEST_NAME),
      ...accuracyColumns(total),
      microsPerCase(total).padStart(9),
    ].join(" "),
  );
});

console.log(
  "\nrecall: of passages that still exist, how many were found." +
    "\nexact:  found to the character. overlap: found, but not to the character." +
    "\nwrong:  of matches returned, how many pointed elsewhere than the truth." +
    "\nrefused: of deleted passages, how many correctly returned nothing." +
    "\n+hint:  given the offset recorded at capture time, stale by the edit." +
    "\nµs:     describe and resolve together, for both implementations." +
    "\n\nThe corpus is this library's own. It is mechanically labelled and" +
    "\nreproducible, but the mutation classes were chosen here, so read the rows" +
    "\nrather than the total.",
);
