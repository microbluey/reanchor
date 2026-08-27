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

# When the reader highlights something, record a selector.
selector = describe_quote(document, 71, 104)
# → TextQuoteSelector(exact='every stored offset silently rots', prefix='', suffix='')

# Later, against a document that has since been edited and re-typeset:
found = resolve_quote(edited_document, selector)
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
- **Context disambiguates, absence of context does not condemn.** A quote
  occurring once needs no context and is not penalized for lacking it. A quote
  occurring three times is penalized whatever its context says, because the
  method could not tell the copies apart.
- **Refusing is a feature.** `resolve_quote` returns `None` rather than the
  least-bad window. A mislocated citation is worse than a missing one: it looks
  verified.

## Measured, not asserted

Anchoring needs no human labels. Take a document, record a selector, mutate the
document by a transformation whose effect on the span you can compute — the
ground truth is mechanical. `python -m bench.resolve` runs 237 such cases over
four documents (English prose, a technical text dense with identifiers,
legal-style numbered clauses, and Chinese where whitespace carries no word
boundaries):

```
mutation                     n  recall   exact  overlap   wrong  refused   µs/case
----------------------------------------------------------------------------------
edit-outside-span           24 100.0% 100.0%   0.0%   0.0%     —       978
reflow-whitespace           24 100.0% 100.0%   0.0%   0.0%     —       907
smarten-punctuation         17 100.0% 100.0%   0.0%   0.0%     —       941
hyphenate-line-break        24 100.0% 100.0%   0.0%   0.0%     —       954
copy-edit-inside-span       17 100.0% 100.0%   0.0%   0.0%     —      8294
delete-span                 24     —     —     —     —  95.8%      7792
duplicate-document          24 100.0% 100.0%   0.0%   0.0%     —      1828
relocate-span               24 100.0% 100.0%   0.0%   0.0%     —       914
compound-retypeset          24 100.0% 100.0%   0.0%   0.0%     —      4975
heavy-rewrite               22  90.9%  77.3%   9.1%   5.0%     —      7901
ocr-noise                   13 100.0% 100.0%   0.0%   0.0%     —      7556
----------------------------------------------------------------------------------
all                        237  99.1%  97.7%   0.9%   0.5%  95.8%      3668
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
refusal are both defensible there, and the 5% mislocation is concentrated in it.
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

Builds a selector for `document[start:end]`. Grows context only as far as needed
to make the selector unique — a distinctive sentence gets none, a repeated
heading gets just enough. Fixed-length context is both too little to
disambiguate and needlessly long to damage.

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
