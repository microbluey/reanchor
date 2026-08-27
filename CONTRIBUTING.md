# Contributing

Thanks for looking. This is a small library with a narrow job, and the bar for
changes is mostly about not breaking the one property it sells: that a returned
location is right, or absent.

## Setup

Two implementations live in one repository. They are ports of each other, not
bindings, and both must stay green.

```
# TypeScript, at the repository root
npm install
npm run check          # typecheck + test
npm run bench

# Python, in python/
cd python
uv sync
uv run pytest
uv run ruff check . && uv run ruff format .
uv run mypy
uv run python -m bench.resolve
```

CI runs the TypeScript suite on Node 18/20/22 and the Python suite on 3.10–3.14.

## The rules that are not negotiable

**A change may not trade correctness for recall.** The floors in
`test/corpus.test.ts` and `python/tests/test_corpus.py` are set just under
measured values, and the `wrong` column is the one that matters. Finding more
passages by returning more guesses is not an improvement — a mislocated citation
is worse than a missing one, because it looks verified.

**Normalization steps must be offset-attributable.** Every fold has to map back
to source offsets: 1→N (`…` → `...`), N→1 (a whitespace run → one space), or
N→0 (a soft hyphen). Nothing may reorder characters. This is what keeps
`src_start`/`src_end` monotonic and therefore binary-searchable, and it is why
`toSourceSpan` can be exact rather than approximate. A step that cannot state
which source characters it came from does not belong here.

**The two implementations share one corpus.** `bench/documents.ts` and
`python/bench/documents.py` hold the same four documents, and the mutation
sequence in `bench/corpus.ts` and `python/bench/corpus.py` must produce
byte-identical cases. If it does not, the two benchmark tables stop being
comparable and each becomes a claim about nothing. Changing a mutation means
changing both sides, and the accuracy columns should still match afterwards.

If you touch the corpus, verify identity rather than assuming it — dump
`mutation \t span \t expected \t sha256(mutated)` per case from both sides and
diff.

**No runtime dependencies.** This library is a leaf that other packages depend
on, and a leaf with dependencies is a leaf with version conflicts. Dev
dependencies are fine.

## Reporting an anchoring bug

An anchoring bug is only actionable with the inputs. Please include the document
(or a reduced version that still misbehaves), the selector, the options, what
was returned, and what you expected. There is an issue template that asks for
exactly this.

"It matched the wrong sentence" is the most valuable kind of report and the
hardest to guess at — the reduced document is doing most of the work.

## Things deliberately out of scope

- **DOM ranges.** Resolve against `textContent` and map back yourself. Keeping
  the DOM out is what lets this run in a worker, in Node, and in a Python
  pipeline.
- **Structural anchors** (heading paths, PDF quads, EPUB CFI). Reasonable
  things to want; a different library, or at least a different module with its
  own corpus.
- **A tokenizer, a stemmer, a language model.** The failure mode this addresses
  is mechanical drift in text, and mechanical tools are auditable against a
  mechanical benchmark.

New rungs on the confidence ladder are welcome if they come with corpus cases
that distinguish them from the rungs above and below.

## Commits

Present tense, and say why rather than what — the diff already says what. If a
change moves a number in the benchmark table, put the before and after in the
message.
