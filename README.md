# reanchor

Find a quote again after the document changed.

You highlighted a sentence last month. Since then the PDF was re-exported, the
CMS migrated, someone fixed a typo two paragraphs up. The stored character
offsets now point at the wrong words — and they point there silently, with the
same confidence they had when they were right.

`reanchor` takes the quoted text plus a little context and tells you where that
passage is *now*, how it found it, and how much to trust the answer. When the
passage is gone, it says so instead of guessing.

```
npm i reanchor
```

Zero dependencies. No DOM, no filesystem, no network. Strings in, offsets out.

## Use

```ts
import { describeQuote, resolveQuote } from "reanchor";

// When the reader highlights something, record a selector.
const selector = describeQuote(document, 1204, 1288);
// → { exact: "every stored offset silently rots", prefix: "", suffix: "" }

// Later, against a document that has since been edited and re-typeset:
const found = resolveQuote(editedDocument, selector);
// → {
//     start: 1331,
//     end: 1414,
//     text: "every stored offset quietly rots",
//     method: "approximate",
//     confidence: 0.91,
//     distance: 3,
//     rivals: [],
//   }

if (found === null) {
  // The passage is gone. Show the annotation as unresolved.
}
```

Resolving many quotes against one document — a citation checker, a page of
highlights — should prepare the document once:

```ts
import { prepareDocument, resolveQuote } from "reanchor";

const prepared = prepareDocument(document);
const results = selectors.map((selector) => resolveQuote(prepared, selector));
```

## How confident is confident

Every result carries the `method` that produced it. They form a ladder, most to
least trustworthy:

| `method` | What it means |
| --- | --- |
| `exact-with-context` | Quote and surrounding context both matched character for character. |
| `exact` | The quote matched exactly. |
| `normalized-with-context` | Matched after folding whitespace, typographic punctuation, and hyphenated line breaks. |
| `normalized` | Same, without context to confirm it. |
| `approximate` | The text has genuinely changed; matched by edit distance. |

Choose your own floor. A citation UI that must never point at the wrong
sentence can demand certainty:

```ts
resolveQuote(document, selector, { maxMethod: "normalized" }); // no fuzzy matching
resolveQuote(document, selector, { minConfidence: 0.9 });      // or a numeric floor
```

`rivals` is the other half of honesty. If a document repeats a passage and the
context could not separate the copies, the alternatives are listed there — a
non-empty `rivals` means treat the primary answer with suspicion.

## Why not just fuzzy search

Approximate string matching finds *a* window. Anchoring has to decide whether
that window is *the* passage, and the difference is most of the work:

- **Offsets must land in the original string.** Matching happens on normalized
  text, so every normalization step here is offset-attributable and
  `toSourceSpan` maps a normalized span back exactly. A collapsed run of
  whitespace maps to the whole run; a `…` that became `...` maps all three dots
  to the one source character.
- **Context disambiguates, absence of context does not condemn.** A quote
  occurring once needs no context and is not penalized for lacking it. A quote
  occurring three times is penalized whatever its context says, because the
  method could not tell the copies apart.
- **Refusing is a feature.** `resolveQuote` returns `null` rather than the
  least-bad window. A mislocated citation is worse than a missing one: it looks
  verified.

## Measured, not asserted

Anchoring needs no human labels. Take a document, record a selector, mutate the
document by a transformation whose effect on the span you can compute — the
ground truth is mechanical. `npm run bench` runs 237 such cases over four
documents (English prose, a technical text dense with identifiers, legal-style
numbered clauses, and Chinese where whitespace carries no word boundaries):

```
mutation                     n  recall   exact  overlap   wrong  refused   µs/case
----------------------------------------------------------------------------------
edit-outside-span           24 100.0% 100.0%   0.0%   0.0%     —       323
reflow-whitespace           24 100.0% 100.0%   0.0%   0.0%     —       297
smarten-punctuation         17 100.0% 100.0%   0.0%   0.0%     —       319
hyphenate-line-break        24 100.0% 100.0%   0.0%   0.0%     —       300
copy-edit-inside-span       17 100.0% 100.0%   0.0%   0.0%     —       713
delete-span                 24     —     —     —     —  95.8%       568
duplicate-document          24 100.0% 100.0%   0.0%   0.0%     —       501
relocate-span               24 100.0% 100.0%   0.0%   0.0%     —       265
compound-retypeset          24 100.0% 100.0%   0.0%   0.0%     —       481
heavy-rewrite               22  90.9%  77.3%   9.1%   5.0%     —       585
ocr-noise                   13 100.0% 100.0%   0.0%   0.0%     —       569
----------------------------------------------------------------------------------
all                        237  99.1%  97.7%   0.9%   0.5%  95.8%       436
```

Three numbers, because they are not the same number. **recall** is how often the
passage was found at all. **wrong** is how often a returned match pointed
somewhere other than the truth — the one that actually hurts users. **refused**
is how often a deleted passage correctly returned nothing.

A library optimizing recall alone scores 100% by always guessing, and mislocates
everything it cannot find. The floors are asserted in `test/corpus.test.ts`, so
trading correctness for recall fails CI.

Reading the table: `heavy-rewrite` reverses the interior of a third of the words,
which is roughly where a passage stops being the same passage — a match and a
refusal are both defensible there, and the 5% mislocation is concentrated in it.
The one unrefused `delete-span` case is a legal document whose clauses repeat
boilerplate almost verbatim; the deleted clause's near-twin is a defensible
match by any threshold that admits real edits.

## API

### `resolveQuote(document, selector, options?)`

`document` is a string or a `PreparedDocument`. Returns `ResolvedQuote | null`.

| Option | Default | |
| --- | --- | --- |
| `minConfidence` | `0.5` | Reject matches below this. |
| `maxEditRatio` | `0.3` | Largest tolerated edit distance, as a fraction of quote length. |
| `contextLength` | `32` | How many characters of context to weigh either side. |
| `maxMethod` | `"approximate"` | Stop at this rung of the ladder. |
| `maxRivals` | `3` | How many alternatives to report. |
| `normalize` | — | Normalization overrides; must match any `prepareDocument`. |

### `describeQuote(document, start, end, options?)`

Builds a selector for `document[start..end)`. Grows context only as far as
needed to make the selector unique — a distinctive sentence gets none, a
repeated heading gets just enough. Fixed-length context is both too little to
disambiguate and needlessly long to damage.

### `resolveQuotes(document, selectors, options?)`

Resolves many selectors, normalizing and indexing the document once.

### `normalize(source, options?)` / `toSourceSpan(normalized, start, end)`

Offset-preserving normalization. Useful on its own if you are matching text
across two representations and need to report positions in the original.
Handles NFKD folding, combining marks, case, typographic punctuation, zero-width
characters, whitespace collapse, and hyphenated line breaks — each
offset-attributable.

### `findExact(haystack, needle)` / `findApproximate(haystack, needle, options?)`

The search layer. `findApproximate` is Sellers' free-end-gap Levenshtein
alignment behind a k-gram diagonal filter, so cost scales with the number of
plausible occurrences rather than document length.

## Standards

The selector shape matches the W3C Web Annotation Data Model's
[TextQuoteSelector](https://www.w3.org/TR/annotation-model/#text-quote-selector),
so selectors are interoperable with annotation tooling that speaks the same
vocabulary. `reanchor` does not depend on the rest of that model, and does not
touch the DOM — if you need DOM ranges, resolve against `textContent` and map
back yourself.

## License

MIT
