"""Run the corpus and report per-mutation accuracy.

Three numbers matter, and they are not the same number:

  recall      -- of the cases where the passage still exists, how many were
                 found at all.
  mislocated  -- of the cases where a match was returned, how many pointed
                 somewhere other than the truth. This is the number that
                 actually hurts users, because a mislocated citation looks
                 verified.
  refusals    -- of the cases where the passage was deleted, how many correctly
                 returned nothing.

A library optimizing recall alone can score 100% by returning its best guess
always, at the cost of mislocating everything it cannot find. Reporting the
three separately makes that trade visible.

Run with ``python -m bench.resolve`` from the ``python/`` directory. The table
should match the one ``npm run bench`` prints at the repository root: same
corpus, same ladder, so a divergence between the two is a bug in one of them.
"""

from __future__ import annotations

import time
from collections.abc import Sequence
from dataclasses import dataclass

from reanchor import describe_quote, resolve_quote

from .corpus import Case, build_corpus
from .documents import DOCUMENTS


@dataclass(slots=True)
class Tally:
    """Counts for one mutation class."""

    resolvable: int = 0
    found: int = 0
    exact_span: int = 0
    overlapping: int = 0
    mislocated: int = 0
    deleted: int = 0
    refused: int = 0
    elapsed_ms: float = 0.0

    def add(self, other: Tally) -> None:
        self.resolvable += other.resolvable
        self.found += other.found
        self.exact_span += other.exact_span
        self.overlapping += other.overlapping
        self.mislocated += other.mislocated
        self.deleted += other.deleted
        self.refused += other.refused
        self.elapsed_ms += other.elapsed_ms

    @property
    def total(self) -> int:
        return self.resolvable + self.deleted


def run(cases: Sequence[Case]) -> dict[str, Tally]:
    """Resolve every case, tallied by mutation class in first-seen order."""
    by_mutation: dict[str, Tally] = {}

    for case in cases:
        tally = by_mutation.setdefault(case.mutation, Tally())

        selector = describe_quote(case.original, case.span.start, case.span.end)
        started = time.perf_counter()
        resolved = resolve_quote(case.mutated, selector)
        tally.elapsed_ms += (time.perf_counter() - started) * 1000

        if case.expected is None:
            tally.deleted += 1
            if resolved is None:
                tally.refused += 1
            continue

        tally.resolvable += 1
        if resolved is None:
            continue
        tally.found += 1

        if resolved.start == case.expected.start and resolved.end == case.expected.end:
            tally.exact_span += 1
        elif resolved.start < case.expected.end and case.expected.start < resolved.end:
            tally.overlapping += 1
        else:
            tally.mislocated += 1

    return by_mutation


def _percent(numerator: int, denominator: int) -> str:
    if denominator == 0:
        return "    —"
    return f"{numerator / denominator * 100:5.1f}%"


def _row(label: str, tally: Tally) -> str:
    n = tally.total
    per_case = "—" if n == 0 else f"{tally.elapsed_ms * 1000 / n:.0f}"
    return " ".join(
        (
            label.ljust(24),
            str(n).rjust(5),
            _percent(tally.found, tally.resolvable),
            _percent(tally.exact_span, tally.resolvable),
            _percent(tally.overlapping, tally.resolvable),
            _percent(tally.mislocated, tally.found),
            _percent(tally.refused, tally.deleted),
            per_case.rjust(9),
        )
    )


def main() -> None:
    cases = build_corpus(DOCUMENTS)
    by_mutation = run(cases)

    header = " ".join(
        (
            "mutation".ljust(24),
            "n".rjust(5),
            "recall".rjust(7),
            "exact".rjust(7),
            "overlap".rjust(8),
            "wrong".rjust(7),
            "refused".rjust(8),
            "µs/case".rjust(9),
        )
    )

    print(f"reanchor benchmark — {len(cases)} cases over {len(DOCUMENTS)} documents\n")
    print(header)
    print("-" * len(header))

    total = Tally()
    for mutation, tally in by_mutation.items():
        print(_row(mutation, tally))
        total.add(tally)

    print("-" * len(header))
    print(_row("all", total))


if __name__ == "__main__":
    main()
