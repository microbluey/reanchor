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

[0.1.1]: https://github.com/microbluey/reanchor/releases/tag/v0.1.1
[0.1.0]: https://github.com/microbluey/reanchor/releases/tag/v0.1.0
