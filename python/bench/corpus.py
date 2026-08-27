"""A benchmark corpus with mechanically known answers.

Anchoring is one of the rare retrieval-adjacent problems that needs no human
labels. Take a document, record a selector for a known span, then mutate the
document by a transformation whose effect on that span you can compute. The
ground truth is not a judgement call: it is the span the mutation moved the
original text to.

That makes claims about this library falsifiable. ``python -m bench.resolve``
reports recall and mislocation rate per mutation class, so a regression shows up
as a number rather than as a broken feeling.

Everything here is deterministic -- a seeded generator, no wall clock -- so two
runs on two machines produce the same corpus and comparable numbers. It is also
deterministic *across implementations*: this module reproduces
``bench/corpus.ts`` case for case, which is what lets the two benchmark tables
be compared rather than merely admired side by side.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Final, NamedTuple

from reanchor import Span

__all__ = [
    "MUTATIONS",
    "Case",
    "Mutation",
    "MutationResult",
    "RandomFn",
    "build_corpus",
    "seeded_random",
    "sentence_spans",
]

#: JavaScript's ``\s`` -- which is also the set ``String.trimStart`` strips --
#: spelled out by codepoint.
#:
#: Python's ``\s`` is close but not equal: it also matches U+001C..U+001F and
#: U+0085, and it omits U+FEFF. The corpus has to be character-identical to the
#: TypeScript one for the two benchmark tables to mean the same thing, and
#: "close enough" is exactly the kind of assumption that stops being true the
#: moment a document contains the character it was wrong about.
_JS_SPACE: Final = "".join(
    map(
        chr,
        (
            0x09,  # CHARACTER TABULATION
            0x0A,  # LINE FEED
            0x0B,  # LINE TABULATION
            0x0C,  # FORM FEED
            0x0D,  # CARRIAGE RETURN
            0x20,  # SPACE
            0xA0,  # NO-BREAK SPACE
            0x1680,  # OGHAM SPACE MARK
            *range(0x2000, 0x200B),  # EN QUAD .. HAIR SPACE
            0x2028,  # LINE SEPARATOR
            0x2029,  # PARAGRAPH SEPARATOR
            0x202F,  # NARROW NO-BREAK SPACE
            0x205F,  # MEDIUM MATHEMATICAL SPACE
            0x3000,  # IDEOGRAPHIC SPACE
            0xFEFF,  # ZERO WIDTH NO-BREAK SPACE
        ),
    )
)

_WHITESPACE_RUN: Final = re.compile(f"[{_JS_SPACE}]+")
_WHITESPACE_SPLIT: Final = re.compile(f"([{_JS_SPACE}]+)")

#: A callable returning a float in ``[0, 1)``, as :func:`seeded_random` produces.
RandomFn = Callable[[], float]


class MutationResult(NamedTuple):
    """A rewritten document plus where the tracked span ended up.

    ``expected`` is ``None`` when the mutation destroyed the span -- in which
    case the resolver is expected to return no match.
    """

    document: str
    expected: Span | None


class Mutation(NamedTuple):
    """A named document rewrite whose effect on a span is computable."""

    name: str
    apply: Callable[[str, Span, RandomFn], MutationResult | None]


def seeded_random(seed: int) -> RandomFn:
    """xorshift32: small, deterministic, adequate for choosing mutation sites."""
    state = (seed & 0xFFFFFFFF) or 0x9E3779B9

    def next_value() -> float:
        nonlocal state
        state ^= (state << 13) & 0xFFFFFFFF
        state ^= state >> 17
        state ^= (state << 5) & 0xFFFFFFFF
        state &= 0xFFFFFFFF
        return state / 0x100000000

    return next_value


def _edit_outside_span(
    document: str, span: Span, rand: RandomFn
) -> MutationResult | None:
    """Replace text outside the span.

    The span's content is untouched, but every offset after the edit shifts --
    which is exactly the failure mode that position-only anchors have and quote
    anchors should not.
    """
    insert_at = math.floor(rand() * span.start)
    inserted = "\n\nAn inserted paragraph, added by a later editor.\n\n"
    return MutationResult(
        document=document[:insert_at] + inserted + document[insert_at:],
        expected=Span(span.start + len(inserted), span.end + len(inserted)),
    )


def _reflow_whitespace(
    document: str, span: Span, rand: RandomFn
) -> MutationResult | None:
    """Re-wrap the document, as a PDF re-export or a CMS migration would."""

    def rewrap(value: str) -> str:
        return _WHITESPACE_RUN.sub(" ", value)

    before = rewrap(document[: span.start])
    inside = rewrap(document[span.start : span.end])
    after = rewrap(document[span.end :])
    return MutationResult(
        document=before + inside + after,
        expected=Span(len(before), len(before) + len(inside)),
    )


def _smarten_punctuation(
    document: str, span: Span, rand: RandomFn
) -> MutationResult | None:
    """Straight punctuation becomes typographic, as most publishing pipelines do."""

    def smarten(value: str) -> str:
        return (
            value.replace(" - ", f" {chr(0x2014)} ")  # EM DASH
            .replace("'", chr(0x2019))  # RIGHT SINGLE QUOTATION MARK
            .replace("...", chr(0x2026))  # HORIZONTAL ELLIPSIS
        )

    before = smarten(document[: span.start])
    inside = smarten(document[span.start : span.end])
    after = smarten(document[span.end :])
    if inside == document[span.start : span.end] and before == document[: span.start]:
        return None
    return MutationResult(
        document=before + inside + after,
        expected=Span(len(before), len(before) + len(inside)),
    )


def _letter_runs(value: str, minimum: int) -> list[tuple[int, str]]:
    """Maximal runs of Unicode letters at least ``minimum`` characters long.

    Stands in for JavaScript's ``/\\p{L}{6,}/gu``, which Python's :mod:`re`
    cannot express. ``str.isalpha`` is true for exactly general category L*, so
    the two agree -- including on CJK, where every character is Lo and a "word"
    is therefore any run of them.
    """
    runs: list[tuple[int, str]] = []
    start: int | None = None
    for index, char in enumerate(value):
        if char.isalpha():
            if start is None:
                start = index
        elif start is not None:
            if index - start >= minimum:
                runs.append((start, value[start:index]))
            start = None
    if start is not None and len(value) - start >= minimum:
        runs.append((start, value[start:]))
    return runs


def _hyphenate_line_break(
    document: str, span: Span, rand: RandomFn
) -> MutationResult | None:
    """Break a word inside the span across a line, as typesetting does."""
    inside = document[span.start : span.end]
    words = _letter_runs(inside, 6)
    if not words:
        return None
    at = words[math.floor(rand() * len(words))][0] + 3
    mutated = f"{inside[:at]}-\n{inside[at:]}"
    return MutationResult(
        document=document[: span.start] + mutated + document[span.end :],
        expected=Span(span.start, span.start + len(mutated)),
    )


_CONFUSIONS: Final[tuple[tuple[re.Pattern[str], str], ...]] = (
    (re.compile("l"), "1"),
    (re.compile("o"), "0"),
    (re.compile(f"e(?=[{_JS_SPACE}])"), "c"),
    (re.compile("rn"), "m"),
)


def _ocr_noise(document: str, span: Span, rand: RandomFn) -> MutationResult | None:
    """OCR-style confusions: l/1, o/0, e/c, rn/m."""
    inside = document[span.start : span.end]
    changed = False

    for pattern, replacement in _CONFUSIONS:

        def substitute(match: re.Match[str], replacement: str = replacement) -> str:
            nonlocal changed
            # Corrupt roughly one in eight candidates, so the quote stays
            # recognizable while no longer matching exactly.
            if rand() > 0.125:
                return match.group(0)
            changed = True
            return replacement

        inside = pattern.sub(substitute, inside)

    if not changed:
        return None
    return MutationResult(
        document=document[: span.start] + inside + document[span.end :],
        expected=Span(span.start, span.start + len(inside)),
    )


_SUBSTITUTIONS: Final[tuple[tuple[str, str], ...]] = (
    ("the ", "this "),
    (" is ", " was "),
    (" are ", " were "),
    ("a ", "one "),
    (" not ", " never "),
)


def _copy_edit_inside_span(
    document: str, span: Span, rand: RandomFn
) -> MutationResult | None:
    """Rewrite a few words inside the span -- a copy-edit, not a re-typeset."""
    inside = document[span.start : span.end]
    applied = 0
    for source, target in _SUBSTITUTIONS:
        if applied >= 2:
            break
        at = inside.find(source, math.floor(rand() * max(1, len(inside) / 2)))
        if at < 0:
            continue
        inside = inside[:at] + target + inside[at + len(source) :]
        applied += 1
    if applied == 0:
        return None
    return MutationResult(
        document=document[: span.start] + inside + document[span.end :],
        expected=Span(span.start, span.start + len(inside)),
    )


def _delete_span(document: str, span: Span, rand: RandomFn) -> MutationResult | None:
    """Delete the span outright.

    The only correct answer is no answer, which is what separates a resolver
    from a nearest-neighbour search: this class is where a library that always
    returns its best guess scores zero.
    """
    return MutationResult(
        document=document[: span.start] + document[span.end :],
        expected=None,
    )


def _duplicate_document(
    document: str, span: Span, rand: RandomFn
) -> MutationResult | None:
    """Duplicate the whole document, so every quote now occurs twice."""
    return MutationResult(document=f"{document}\n\n{document}", expected=span)


def _relocate_span(document: str, span: Span, rand: RandomFn) -> MutationResult | None:
    """Move the span to the end of the document.

    Position-based anchoring cannot pass this at all; quote-based anchoring
    should not even notice it.
    """
    inside = document[span.start : span.end]
    remainder = document[: span.start] + document[span.end :]
    return MutationResult(
        document=f"{remainder}\n\n{inside}",
        expected=Span(len(remainder) + 2, len(remainder) + 2 + len(inside)),
    )


def _compound_retypeset(
    document: str, span: Span, rand: RandomFn
) -> MutationResult | None:
    """Everything a publishing pipeline does at once.

    Re-wrap, smarten punctuation, hyphenate across lines, and add noise.
    Individually each of these is mild; compounded they are where naive
    normalization stops being enough.
    """
    current = MutationResult(document=document, expected=span)
    for mutation in (
        _reflow_whitespace,
        _smarten_punctuation,
        _hyphenate_line_break,
        _ocr_noise,
    ):
        if current.expected is None:
            break
        following = mutation(current.document, current.expected, rand)
        if following is not None:
            current = following
    if current.document == document:
        return None
    return current


def _heavy_rewrite(document: str, span: Span, rand: RandomFn) -> MutationResult | None:
    """Rewrite about a third of the span.

    Past this much change the passage has arguably become a different passage,
    so either a match or a refusal is defensible -- the corpus records the truth
    and the report shows what the resolver chose, without asserting one is
    correct.
    """
    inside = document[span.start : span.end]
    changed = 0
    pieces: list[str] = []
    for word in _WHITESPACE_SPLIT.split(inside):
        if _WHITESPACE_RUN.fullmatch(word) or len(word) < 4:
            pieces.append(word)
            continue
        if rand() > 0.33:
            pieces.append(word)
            continue
        changed += 1
        # Reverse the interior, keeping first and last letters, so length and
        # shape survive while the characters no longer align.
        pieces.append(word[0] + word[1:-1][::-1] + word[-1])
    rewritten = "".join(pieces)
    if changed == 0:
        return None
    return MutationResult(
        document=document[: span.start] + rewritten + document[span.end :],
        expected=Span(span.start, span.start + len(rewritten)),
    )


MUTATIONS: Final[tuple[Mutation, ...]] = (
    Mutation("edit-outside-span", _edit_outside_span),
    Mutation("reflow-whitespace", _reflow_whitespace),
    Mutation("smarten-punctuation", _smarten_punctuation),
    Mutation("hyphenate-line-break", _hyphenate_line_break),
    Mutation("ocr-noise", _ocr_noise),
    Mutation("copy-edit-inside-span", _copy_edit_inside_span),
    Mutation("delete-span", _delete_span),
    Mutation("duplicate-document", _duplicate_document),
    Mutation("relocate-span", _relocate_span),
    Mutation("compound-retypeset", _compound_retypeset),
    Mutation("heavy-rewrite", _heavy_rewrite),
)


@dataclass(frozen=True, slots=True)
class Case:
    """One (document, span, mutation) triple with its known answer."""

    mutation: str
    original: str
    mutated: str
    span: Span
    expected: Span | None


def build_corpus(documents: Sequence[str], seed: int = 20260827) -> list[Case]:
    """Build every (document, span, mutation) case that applies.

    Spans are chosen on sentence boundaries, which is what a person highlighting
    a citation actually selects.
    """
    rand = seeded_random(seed)
    cases: list[Case] = []

    for document in documents:
        for span in sentence_spans(document):
            for mutation in MUTATIONS:
                result = mutation.apply(document, span, rand)
                if result is None:
                    continue
                cases.append(
                    Case(
                        mutation=mutation.name,
                        original=document,
                        mutated=result.document,
                        span=span,
                        expected=result.expected,
                    )
                )
    return cases


_SENTENCE: Final = re.compile(r"[^.!?\n]{40,}[.!?]")


def sentence_spans(document: str) -> list[Span]:
    """Sentence-ish spans of at least 40 characters, which is where quoting starts."""
    spans: list[Span] = []
    for match in _SENTENCE.finditer(document):
        text = match.group(0)
        leading = len(text) - len(text.lstrip(_JS_SPACE))
        spans.append(Span(match.start() + leading, match.start() + len(text)))
    return spans
