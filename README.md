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

Zero dependencies. Strings in, offsets out. The core touches no DOM, no
filesystem, and no network; `reanchor/dom` is a separate entry point for callers
who have a page rather than a string.

## Use

```ts
import { describeQuote, resolveQuote } from "reanchor";

const document =
  "Stored offsets look right long after they stopped being right, " +
  "because every stored offset silently rots at the same confidence " +
  "it had when it was correct.";

// When the reader highlights something, record a selector.
const selector = describeQuote(document, 71, 104);
// → {
//     exact: "every stored offset silently rots",
//     prefix: " right, because ",
//     suffix: " at the same con",
//   }

// Later. Someone rewrote the opening clause and swapped a word inside the
// quote itself, so the stored offsets 71..104 now point two characters early
// at text that no longer reads the same.
const edited = document
  .replace("Stored offsets look right", "A stored offset looks right")
  .replace("silently rots", "quietly rots");

const found = resolveQuote(edited, selector);
// → {
//     start: 73,
//     end: 105,
//     text: "every stored offset quietly rots",
//     method: "approximate",
//     confidence: 0.834848,
//     distance: 4,
//     rivals: [],
//   }

if (found === null) {
  // The passage is gone. Show the annotation as unresolved.
}
```

The passage moved and no longer reads the same, and both facts are reported
rather than hidden: `approximate` says the text was edited, `distance: 4` says by
how much, and `confidence` prices the answer. That is why a result is not just a
span.

Resolving many quotes against one document — a citation checker, a page of
highlights — should prepare the document once:

```ts
import { prepareDocument, resolveQuote } from "reanchor";

const prepared = prepareDocument(document);
const results = selectors.map((selector) => resolveQuote(prepared, selector));
```

## In a browser

An annotation tool holds a page, not a string, and wants a `Range` it can
highlight. `reanchor/dom` flattens a root's text nodes into one stream, resolves
against that, and maps the answer back to a range:

```ts
import { describeRange, resolveRange } from "reanchor/dom";

// When the reader selects something.
const selector = describeRange(document.body, window.getSelection()!.getRangeAt(0));

// Later, on a page that has since been edited.
const found = resolveRange(document.body, selector);
if (found === null) {
  showAsUnresolved();
} else if (found.confidence < 0.8) {
  showAsApproximate(found.range);   // found, but the passage was edited
} else {
  found.range.surroundContents(document.createElement("mark"));
}
```

`resolveRange` returns everything `resolveQuote` does, plus the `range` — so a
caller can still refuse to highlight, which is the whole point of carrying a
`method` and a `confidence` around.

Walking the DOM is usually the expensive half, so resolve many selectors at once
with `resolveRanges(root, selectors)`, or hold a `mapTextNodes(root)` and pass it
where a root is expected.

Offsets agree character for character with `root.textContent`, which keeps
positions recorded by other libraries valid. Pass `include` to exclude text that
is text to the DOM but not to a reader:

```ts
const include = (node: Text) => !node.parentElement?.closest("script, style");
resolveRange(root, selector, { include });
```

A selector recorded under one `include` must be resolved under the same one —
they describe different documents otherwise.

### Migrating from `dom-anchor-text-quote`

`reanchor/dom` exports `fromRange`, `toRange`, `fromTextPosition`, and
`toTextPosition` with the same signatures, so the change is the import:

```diff
- import { fromRange, toRange } from "dom-anchor-text-quote";
+ import { fromRange, toRange } from "reanchor/dom";
```

Selectors already stored by that library keep resolving, and selectors written
by this one resolve through it, so a migration can be partial. Four differences
are worth knowing:

- **Context is grown, not fixed at 32 characters.** `fromRange` extends context
  until the quote is unique in the document, which is what lets repeated
  passages be told apart later. Selectors get longer.
- **A range ends inside the node holding its last character**, rather than at
  offset 0 of the following node. Both stringify identically, but the latter
  lifts the range's common ancestor to the parent element and
  `surroundContents` then throws — so highlighting fails on any quote ending at
  a node boundary.
- **`options.hint` is accepted and ignored.** That library searches outward from
  a position hint, so the hint decides which copy of a repeated passage it
  finds. This one ranks copies by context agreement and reports the rest as
  `rivals`. Proximity is a reasonable second signal, but it would have to earn
  its place against the benchmark rather than be honoured silently because the
  parameter was passed.
- **Types ship with the package.** No hand-written `.d.ts` needed.

Prefer `resolveRange` over `toRange` in new code: a bare range cannot tell you
whether it was found character for character or reconstructed from an edited
passage, and a caller that renders both identically is a caller that shows wrong
citations as verified.

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
- **Context disambiguates, and it is recorded even when nothing needs
  disambiguating yet.** A quote unique today can stop being unique tomorrow —
  the passage is revised and a verbatim copy of the old wording survives
  elsewhere, so the only character-for-character match left is the stale copy.
  Context is what tells them apart, so `describeQuote` always records some.
  Context that was itself partly edited still counts, scored by longest common
  affix rather than required to match.
- **Ambiguity costs a candidate its own indistinguishability, not its
  company.** A rung that found three copies but whose recorded context puts one
  of them clearly in front has told them apart; only candidates tied at the top
  of their rung — where the choice really is a coin flip — are penalized.
- **Refusing is a feature.** `resolveQuote` returns `null` rather than the
  least-bad window. A mislocated citation is worse than a missing one: it looks
  verified.

## Measured, not asserted

Anchoring needs no human labels. Take a document, record a selector, mutate the
document by a transformation whose effect on the span you can compute — the
ground truth is mechanical. `npm run bench` runs 256 such cases over four
documents (English prose, a technical text dense with identifiers, legal-style
numbered clauses, and Chinese where whitespace carries no word boundaries):

```
mutation                     n  recall   exact  overlap   wrong  refused   µs/case
----------------------------------------------------------------------------------
edit-outside-span           24 100.0% 100.0%   0.0%   0.0%     —       377
reflow-whitespace           24 100.0% 100.0%   0.0%   0.0%     —       360
smarten-punctuation         17 100.0% 100.0%   0.0%   0.0%     —       326
hyphenate-line-break        24 100.0% 100.0%   0.0%   0.0%     —       340
copy-edit-inside-span       17 100.0% 100.0%   0.0%   0.0%     —       833
delete-span                 24     —     —     —     —  95.8%       650
duplicate-document          24 100.0% 100.0%   0.0%   0.0%     —      1044
relocate-span               24 100.0% 100.0%   0.0%   0.0%     —       661
compound-retypeset          24 100.0% 100.0%   0.0%   0.0%     —       528
heavy-rewrite               22  90.9%  81.8%   9.1%   0.0%     —       651
decoy-survives-edit         19 100.0% 100.0%   0.0%   0.0%     —       741
ocr-noise                   13 100.0% 100.0%   0.0%   0.0%     —       665
----------------------------------------------------------------------------------
all                        256  99.1%  98.3%   0.9%   0.0%  95.8%       593
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
refusal are both defensible there, and it accounts for all of the 0.9% overlap
(a span found but not to the character). `decoy-survives-edit` is the hard case:
the quoted passage is revised in place while an untouched verbatim copy survives
elsewhere, so the exact text exists — just not where the annotation belongs.
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

Builds a selector for `document[start..end)`. Records `minContextLength`
characters either side, then grows only as far as needed to make the selector
unique — a repeated heading gets just enough. It never records none: a quote
that is unique today can be revised tomorrow while a verbatim copy survives
elsewhere, and context is the only evidence that tells the two apart.

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

### `reanchor/dom`

A separate entry point; importing `reanchor` pulls in neither DOM types nor DOM
assumptions.

| Export | |
| --- | --- |
| `describeRange(root, range, options?)` | Record a selector for a range. |
| `resolveRange(root, selector, options?)` | Resolve to `DomResolvedQuote \| null` — a `ResolvedQuote` plus `range`. |
| `resolveRanges(root, selectors, options?)` | The same for many selectors, walking the DOM once. |
| `mapTextNodes(root, options?)` | The flattened text and per-node offsets, reusable in place of `root`. |
| `fromRange` / `toRange` / `fromTextPosition` / `toTextPosition` | The `dom-anchor-text-quote` surface. |

`root` is any `Node`; a text node works as its own root. Options are
`ResolveOptions` plus `include`, a predicate over text nodes deciding which ones
are part of the document.

## Standards

The selector shape matches the W3C Web Annotation Data Model's
[TextQuoteSelector](https://www.w3.org/TR/annotation-model/#text-quote-selector),
so selectors are interoperable with annotation tooling that speaks the same
vocabulary. `reanchor` does not depend on the rest of that model. The core does
not touch the DOM; [`reanchor/dom`](#in-a-browser) does, in its own entry point,
and is source-compatible with `dom-anchor-text-quote`.

## Python

The same library, same algorithm, lives in [`python/`](python/) and on PyPI:

```
pip install reanchor
```

It is not a binding — it is a port, held to the same corpus. The 256 mutated
cases are verified byte-identical between the two implementations, and the
accuracy columns of the two benchmark tables match case for case; only the
timing column differs. Anchoring tends to straddle a language boundary, with the
highlight recorded in a browser and the citation checked in a Python pipeline, so
both halves need to agree about where a quote is. The port covers the core; the
DOM adapter has no Python counterpart, there being no DOM.

Selectors travel between the two; raw offsets do not. JavaScript string indices
count UTF-16 code units and Python's count code points, which agree for any
document inside the Basic Multilingual Plane and diverge at the first emoji or
rare CJK ideograph. Store the selector.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: a change may not trade
correctness for recall, normalization steps must be offset-attributable, the two
implementations share one corpus, and there are no runtime dependencies.

Bug reports about a wrong match are the most useful thing you can send, and the
hardest to guess at — a reduced document that still misbehaves becomes a corpus
case, which is how it stays fixed.

## License

MIT
