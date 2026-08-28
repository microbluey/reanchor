# Changelog

Notable changes to both implementations. They ship as one version: a selector
described by one must resolve in the other, so they are released together and
share a number.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Because this library's contract includes *where* it says a quote is, a change
that moves a passage from found to refused — or from one location to another —
is a breaking change even when no type changes. Such changes will name the
benchmark columns they move.

## [Unreleased]

A resolution change: quotes whose original wording survives verbatim elsewhere
in an edited document now resolve to the edited original rather than to the
surviving copy. Reported against Hypothesis as
[client#7571](https://github.com/hypothesis/client/issues/7571) and now a
benchmark class, `decoy-survives-edit`, which went from 100% mislocated to 100%
exact. Benchmark totals move `237 → 256` cases, exact spans `97.7% → 98.3%`,
mislocation `0.5% → 0.0%`; recall and refusal are unchanged at 99.1% and 95.8%.

Selectors recorded by a previous version still resolve, but a selector recorded
for a quote that was unique at capture time carries no context and so cannot
benefit from any of this — re-describing such selectors is worthwhile where the
document is still available.

### Changed

- `describeQuote` / `describe_quote` records `minContextLength` characters of
  context even for a quote that is unique in the document, where it previously
  recorded none. Uniqueness at capture time is not uniqueness at resolve time:
  when the passage is later revised and a verbatim copy of the old wording
  survives elsewhere, context is the only evidence distinguishing the revised
  original from the stale copy, and a selector recorded without it has discarded
  that evidence before the ambiguity existed. **Breaking** for callers asserting
  on empty `prefix` / `suffix`, and it makes selectors longer.
- The ladder no longer stops at the first rung that matches anything. A rung's
  match can score below what a lower rung could award — an exact hit whose
  surroundings contradict the recorded context is worth less than an approximate
  hit whose surroundings agree — so rungs are collected while a lower one could
  still win, and the answer is the best-scoring candidate rather than the
  highest-rung one. Unambiguous matches score their rung's base confidence and
  still stop immediately, so the common case costs nothing.
- The ambiguity penalty now falls on candidates tied at the top of their rung
  rather than on every candidate of a rung that matched more than once. A rung
  that found three copies but whose recorded context puts one clearly in front
  has told them apart; penalizing that survivor let a worse rung's
  unambiguous-but-wrong answer outrank it.

### Fixed

- A location reachable by more than one rung — the same span found both exactly
  and after normalization — could be reported as a rival to itself. Locations are
  now kept once, at their best score.

## [0.1.1] — 2026-08-28

No changes to either library. This release exists so that every published
artifact is traceable to a commit: npm's `0.1.0` was published by hand, because
npm will not configure a trusted publisher for a package that does not yet
exist, so it carries no provenance attestation. `0.1.1` is the first npm
artifact published by the release workflow via OIDC. PyPI's `0.1.0` already had
one and is unaffected.

### Fixed

- The npm publish job pinned Node 22, whose bundled npm 10.9 predates trusted
  publishing; the pin also made upgrading npm in place unsatisfiable. The job now
  takes the Node 24 line and fails early with a version check rather than on an
  opaque auth error.

## [0.1.0] — 2026-08-27

First release. TypeScript on npm, Python on PyPI, same algorithm and same
corpus.

### Added

- `resolveQuote` / `resolve_quote` — locate a W3C `TextQuoteSelector` in a
  document that has since changed. Returns the span, the rung of the confidence
  ladder that found it, a confidence, the edit distance, and any rivals; returns
  `null` / `None` rather than the least-bad window.
- `describeQuote` / `describe_quote` — record a selector, growing context only
  as far as needed to make it unique.
- `resolveQuotes` / `resolve_quotes` and `prepareDocument` / `prepare_document`
  — normalize and index a document once across many selectors.
- `normalize` / `toSourceSpan` / `to_source_span` — offset-preserving
  normalization. NFKD folding, combining marks, case, typographic punctuation,
  zero-width characters, whitespace collapse, and hyphenated line breaks, each
  attributable back to source offsets.
- `findExact` / `findApproximate` and their Python equivalents — Sellers'
  free-end-gap alignment behind a k-gram diagonal filter.
- A mechanically-labelled benchmark: 237 cases across 11 mutation classes over
  four documents (English prose, identifier-dense technical text, repetitive
  legal clauses, and Chinese). Accuracy floors are asserted in the test suites of
  both implementations, so trading correctness for recall fails CI.

Measured at release: 99.1% recall, 97.7% exact spans, 0.5% mislocated, 95.8% of
deleted passages correctly refused — identical in both implementations, over a
corpus verified byte-identical between them.

[Unreleased]: https://github.com/microbluey/reanchor/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/microbluey/reanchor/releases/tag/v0.1.1
[0.1.0]: https://github.com/microbluey/reanchor/releases/tag/v0.1.0
