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
pip install reanchor
```

Zero dependencies. No filesystem, no network. Strings in, offsets out. Fully
typed, `py.typed` shipped.

## Use

```python
from reanchor import describe_quote, resolve_quote

document = (
    "Stored offsets look right long after they stopped being right, "
    "because every stored offset silently rots at the same confidence "
    "it had when it was correct."
)

# When the reader highlights something, record a selector.
selector = describe_quote(document, 71, 104)
# → TextQuoteSelector(
#       exact='every stored offset silently rots',
#       prefix=' right, because ',
#       suffix=' at the same con',
#   )

# Later. Someone rewrote the opening clause and swapped a word inside the
# quote itself, so the stored offsets 71..104 now point two characters early
# at text that no longer reads the same.
edited = document.replace(
    "Stored offsets look right", "A stored offset looks right"
).replace("silently rots", "quietly rots")

found = resolve_quote(edited, selector)
# → ResolvedQuote(
#       start=73,
#       end=105,
#       text='every stored offset quietly rots',
#       method='approximate',
#       confidence=0.834848,
#       distance=4,
#       rivals=(),
#   )

if found is None:
    ...  # The passage is gone. Show the annotation as unresolved.
```

The passage moved and no longer reads the same, and both facts are reported
rather than hidden: `approximate` says the text was edited, `distance=4` says by
how much, and `confidence` prices the answer. That is why a result is not just a
span.

Resolving many quotes against one document — a citation checker, a page of
highlights — should prepare the document once:

```python
from reanchor import prepare_document, resolve_quote

prepared = prepare_document(document)
results = [resolve_quote(prepared, selector) for selector in selectors]
```

Or, equivalently, `resolve_quotes(document, selectors)`.

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

Choose your own floor:

```python
from reanchor import ResolveOptions, resolve_quote

# Stop before the fuzzy rung: never return a match the text no longer supports.
resolve_quote(document, selector, ResolveOptions(max_method="normalized"))

# Or set a numeric floor and let the ladder run all the way down.
resolve_quote(document, selector, ResolveOptions(min_confidence=0.9))
```

`rivals` is the other half of honesty. If a document repeats a passage and the
context could not separate the copies, the alternatives are listed there — a
non-empty `rivals` means treat the primary answer with suspicion.

## Why not just fuzzy search

`difflib`, `rapidfuzz`, and friends find *a* window. Anchoring has to decide
whether that window is *the* passage, and the difference is most of the work:

- **Offsets must land in the original string.** Matching happens on normalized
  text, so every normalization step here is offset-attributable and
  `to_source_span` maps a normalized span back exactly. A collapsed run of
  whitespace maps to the whole run; a `…` that became `...` maps all three dots
  to the one source character.
- **Context disambiguates, and it is recorded even when nothing needs
  disambiguating yet.** A quote unique today can stop being unique tomorrow —
  the passage is revised and a verbatim copy of the old wording survives
  elsewhere, so the only character-for-character match left is the stale copy.
  Context is what tells them apart, so `describe_quote` always records some.
  Context that was itself partly edited still counts, scored by longest common
  affix rather than required to match.
- **Ambiguity costs a candidate its own indistinguishability, not its
  company.** A rung that found three copies but whose recorded context puts one
  of them clearly in front has told them apart; only candidates tied at the top
  of their rung — where the choice really is a coin flip — are penalized.
- **Refusing is a feature.** `resolve_quote` returns `None` rather than the
  least-bad window. A mislocated citation is worse than a missing one: it looks
  verified.

## Measured, not asserted

Anchoring needs no human labels. Take a document, record a selector, mutate the
document by a transformation whose effect on the span you can compute — the
ground truth is mechanical. `python -m bench.resolve` runs 256 such cases over
four documents (English prose, a technical text dense with identifiers,
legal-style numbered clauses, and Chinese where whitespace carries no word
boundaries):

```
mutation                     n  recall   exact  overlap   wrong  refused   µs/case
----------------------------------------------------------------------------------
edit-outside-span           24 100.0% 100.0%   0.0%   0.0%     —       954
reflow-whitespace           24 100.0% 100.0%   0.0%   0.0%     —       936
smarten-punctuation         17 100.0% 100.0%   0.0%   0.0%     —       972
hyphenate-line-break        24 100.0% 100.0%   0.0%   0.0%     —       967
copy-edit-inside-span       17 100.0% 100.0%   0.0%   0.0%     —      8342
delete-span                 24     —     —     —     —  95.8%      7728
duplicate-document          24 100.0% 100.0%   0.0%   0.0%     —      9360
relocate-span               24 100.0% 100.0%   0.0%   0.0%     —      7400
compound-retypeset          24 100.0% 100.0%   0.0%   0.0%     —      4988
heavy-rewrite               22  90.9%  81.8%   9.1%   0.0%     —      7838
decoy-survives-edit         19 100.0% 100.0%   0.0%   0.0%     —      8428
ocr-noise                   13 100.0% 100.0%   0.0%   0.0%     —      7630
----------------------------------------------------------------------------------
all                        256  99.1%  98.3%   0.9%   0.0%  95.8%      5336
```

Three numbers, because they are not the same number. **recall** is how often the
passage was found at all. **wrong** is how often a returned match pointed
somewhere other than the truth — the one that actually hurts users. **refused**
is how often a deleted passage correctly returned nothing.

A library optimizing recall alone scores 100% by always guessing, and mislocates
everything it cannot find. The floors are asserted in `tests/test_corpus.py`, so
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

The accuracy columns are identical to the TypeScript implementation's, case for
case, over a corpus verified byte-identical between the two. Only `µs/case`
differs: pure Python pays an interpreter tax on the alignment inner loop that no
amount of algorithmic care removes.

## API

### `resolve_quote(document, selector, options=DEFAULT_RESOLVE_OPTIONS)`

`document` is a `str` or a `PreparedDocument`. Returns `ResolvedQuote | None`.
Options are a frozen `ResolveOptions` dataclass:

| Field | Default | |
| --- | --- | --- |
| `min_confidence` | `0.5` | Reject matches below this. |
| `max_edit_ratio` | `0.3` | Largest tolerated edit distance, as a fraction of quote length. |
| `context_length` | `32` | How many characters of context to weigh either side. |
| `max_method` | `"approximate"` | Stop at this rung of the ladder. |
| `max_rivals` | `3` | How many alternatives to report. |
| `normalize` | `NormalizeOptions()` | Normalization; must match any `prepare_document`. |

### `describe_quote(document, start, end, options=DEFAULT_DESCRIBE_OPTIONS)`

Builds a selector for `document[start:end]`. Records `min_context_length`
characters either side, then grows only as far as needed to make the selector
unique — a repeated heading gets just enough. It never records none: a quote
that is unique today can be revised tomorrow while a verbatim copy survives
elsewhere, and context is the only evidence that tells the two apart.

### `resolve_quotes(document, selectors, options=DEFAULT_RESOLVE_OPTIONS)`

Resolves many selectors, normalizing and indexing the document once.

### `normalize(source, options=DEFAULT_OPTIONS)` / `to_source_span(normalized, start, end)`

Offset-preserving normalization. Useful on its own if you are matching text
across two representations and need to report positions in the original.
Handles NFKD folding, combining marks, case, typographic punctuation, zero-width
characters, whitespace collapse, and hyphenated line breaks — each
offset-attributable.

### `find_exact(haystack, needle)` / `find_approximate(haystack, needle, options=DEFAULT_SEARCH_OPTIONS)`

The search layer. `find_approximate` is Sellers' free-end-gap Levenshtein
alignment behind a k-gram diagonal filter, so cost scales with the number of
plausible occurrences rather than document length.

## Standards, and one portability caveat

The selector shape matches the W3C Web Annotation Data Model's
[TextQuoteSelector](https://www.w3.org/TR/annotation-model/#text-quote-selector),
so selectors are interoperable with annotation tooling that speaks the same
vocabulary. `reanchor` does not depend on the rest of that model.

Selectors travel between implementations; raw offsets do not. Python string
indices count code points, while the TypeScript implementation in the same
repository — same algorithm, same corpus — reports UTF-16 code units, as
JavaScript strings do. The two agree for any document inside the Basic
Multilingual Plane and diverge past it, at the first emoji or rare CJK
ideograph. Store the selector, not the offsets, and either side can resolve it.

## Development

```
uv sync
uv run pytest
uv run ruff check . && uv run ruff format --check .
uv run mypy
uv run python -m bench.resolve
```

## License

MIT
