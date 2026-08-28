"""The corpus as a regression gate.

``python -m bench.resolve`` prints the table for a human; this asserts the
floors so that a change which trades correctness for recall fails CI. The
thresholds are the same ones the TypeScript suite asserts, set just below
currently measured values, so they catch regressions without needing an update
on every improvement.
"""

from __future__ import annotations

import time

from bench.corpus import MUTATIONS, build_corpus
from bench.documents import DOCUMENTS
from reanchor import describe_quote, resolve_quote

CASES = build_corpus(DOCUMENTS)


def test_covers_every_mutation_class_over_every_document() -> None:
    assert len(CASES) > 200
    assert {case.mutation for case in CASES} == {m.name for m in MUTATIONS}
    assert len(MUTATIONS) == 12


def test_meets_the_accuracy_floors() -> None:
    resolvable = found = exact = mislocated = deleted = refused = 0

    for case in CASES:
        selector = describe_quote(case.original, case.span.start, case.span.end)
        resolved = resolve_quote(case.mutated, selector)

        if case.expected is None:
            deleted += 1
            if resolved is None:
                refused += 1
            continue

        resolvable += 1
        if resolved is None:
            continue
        found += 1
        if resolved.start == case.expected.start and resolved.end == case.expected.end:
            exact += 1
        elif resolved.start >= case.expected.end or case.expected.start >= resolved.end:
            mislocated += 1

    assert found / resolvable >= 0.97
    assert exact / resolvable >= 0.97
    # The number that actually hurts users: a match pointing somewhere else.
    assert mislocated / found <= 0.01
    assert refused / deleted >= 0.9


def test_never_mislocates_when_the_passage_is_unchanged() -> None:
    for case in CASES:
        if case.mutation != "edit-outside-span":
            continue
        selector = describe_quote(case.original, case.span.start, case.span.end)
        resolved = resolve_quote(case.mutated, selector)
        assert resolved is not None
        assert case.expected is not None
        assert (resolved.start, resolved.end) == case.expected


def test_is_deterministic_across_runs() -> None:
    again = build_corpus(DOCUMENTS)
    assert [case.mutated for case in again] == [case.mutated for case in CASES]


def test_resolves_at_a_workable_rate() -> None:
    prepared = [
        (case, describe_quote(case.original, case.span.start, case.span.end))
        for case in CASES
    ]
    started = time.perf_counter()
    for case, selector in prepared:
        resolve_quote(case.mutated, selector)
    per_case_ms = (time.perf_counter() - started) * 1000 / len(prepared)
    # Generous, and deliberately looser than the TypeScript suite's 10 ms: pure
    # Python pays an interpreter tax on the alignment inner loop that no amount
    # of algorithmic care removes. The floor exists to catch an accidental
    # return to the quadratic path, not to police the constant factor.
    assert per_case_ms < 50
