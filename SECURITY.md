# Security Policy

## Supported versions

The latest minor release of each implementation receives fixes. There are no
older lines yet.

## Reporting a vulnerability

Report privately via [GitHub Security
Advisories](https://github.com/microbluey/reanchor/security/advisories/new)
rather than a public issue.

## What is in scope

This library has no network access, no filesystem access, and no runtime
dependencies. It takes strings and returns offsets. That narrows the realistic
surface to two things, both of which are in scope:

- **Denial of service through pathological input.** The approximate rung is a
  quadratic alignment behind a k-gram filter, with caps on windows aligned
  (`maxWindows`, default 8), postings considered per seed (256), and unseeded
  whole-document alignment (2²⁰ characters). An input that defeats those caps
  and makes resolution superlinear in document length is a bug worth reporting —
  especially if the document or the selector could come from an untrusted source,
  which is the normal case for a citation checker.

- **Crashes or unbounded memory on malformed text.** Lone surrogates, deeply
  combined graphemes, and adversarial normalization inputs should produce a
  result or a refusal, not an exception or an allocation proportional to
  something unexpected.

## What is not a vulnerability

A wrong or missed match is a correctness bug, not a security one — please open a
normal issue with the reduced document. `reanchor` returns a location and a
confidence; it makes no claim that a resolved quote is authentic, unmodified, or
authorized. If a quote's integrity matters, sign it.
