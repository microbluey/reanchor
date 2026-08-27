"""Tests for the resolution ladder and for describing quotes."""

from __future__ import annotations

import re

import pytest

from reanchor import (
    DescribeOptions,
    ResolveOptions,
    TextQuoteSelector,
    describe_quote,
    prepare_document,
    resolve_quote,
    resolve_quotes,
)

ARTICLE = "\n".join(
    [
        "# Robust anchoring",
        "",
        "Annotations are stored apart from the documents they describe. When the",
        "document changes, every stored offset silently rots: the highlight still",
        "renders, but over the wrong words.",
        "",
        "## Why offsets rot",
        "",
        "A position selector is a promise about a byte layout, and byte layouts are",
        "not stable across a re-export, a CMS migration, or a second pass of OCR.",
        "",
        "## What survives",
        "",
        "Quoted text plus a little context survives most of these changes, because",
        "it describes the passage rather than its coordinates.",
    ]
)


def test_finds_an_unchanged_quote_exactly() -> None:
    result = resolve_quote(
        ARTICLE, TextQuoteSelector(exact="every stored offset silently rots")
    )
    assert result is not None
    assert result.method == "exact"
    assert result.confidence == 1
    assert result.distance == 0
    assert ARTICLE[result.start : result.end] == "every stored offset silently rots"


def test_prefers_the_occurrence_whose_context_agrees() -> None:
    document = "the cat sat on the mat. the dog sat on the rug."
    result = resolve_quote(
        document,
        TextQuoteSelector(exact="sat on the", prefix="the dog ", suffix=" rug"),
    )
    assert result is not None
    assert result.method == "exact-with-context"
    assert result.start == document.rindex("sat on the")
    assert result.rivals == ()


def test_reports_rivals_when_a_repeated_quote_has_no_context() -> None:
    document = "the cat sat on the mat. the dog sat on the rug."
    result = resolve_quote(document, TextQuoteSelector(exact="sat on the"))
    assert result is not None
    assert len(result.rivals) == 1
    assert result.confidence < 1


def test_survives_re_typeset_whitespace() -> None:
    reflowed = re.sub(r" {2,}", " ", ARTICLE.replace("\n", " "))
    result = resolve_quote(
        reflowed,
        TextQuoteSelector(
            exact="the highlight still\nrenders, but over the wrong words"
        ),
    )
    assert result is not None
    assert result.method == "normalized"
    assert result.distance == 0
    assert (
        reflowed[result.start : result.end]
        == "the highlight still renders, but over the wrong words"
    )


def test_survives_typographic_substitution() -> None:
    document = "She called it a “promise about a byte layout”—her words."
    result = resolve_quote(
        document, TextQuoteSelector(exact='"promise about a byte layout"')
    )
    assert result is not None
    assert result.method == "normalized"
    assert document[result.start : result.end] == "“promise about a byte layout”"


def test_survives_a_hyphenated_line_break_from_re_typesetting() -> None:
    document = (
        "not stable across a re-export, a CMS mi-\ngration, or a second pass of OCR."
    )
    result = resolve_quote(document, TextQuoteSelector(exact="a CMS migration"))
    assert result is not None
    assert result.method == "normalized"
    assert document[result.start : result.end] == "a CMS mi-\ngration"


def test_survives_a_genuine_edit_inside_the_quote() -> None:
    edited = ARTICLE.replace("silently rots", "quietly rots")
    result = resolve_quote(
        edited, TextQuoteSelector(exact="every stored offset silently rots")
    )
    assert result is not None
    assert result.method == "approximate"
    assert result.distance > 0
    assert "quietly rots" in edited[result.start : result.end]


def test_survives_ocr_noise() -> None:
    scanned = ARTICLE.replace("byte layouts are", "byte 1ayouts arc")
    result = resolve_quote(
        scanned,
        TextQuoteSelector(exact="a promise about a byte layout, and byte layouts are"),
    )
    assert result is not None
    assert result.confidence > 0.6
    assert "byte 1ayouts arc" in scanned[result.start : result.end]


def test_returns_none_when_the_passage_was_deleted() -> None:
    result = resolve_quote(
        ARTICLE,
        TextQuoteSelector(
            exact="a paragraph that was never in this document at all, about turbines"
        ),
    )
    assert result is None


def test_returns_none_rather_than_the_least_bad_window() -> None:
    # Half the words are shared with the document, which is exactly the case
    # where a resolver without a floor would return something confident and
    # wrong.
    result = resolve_quote(
        ARTICLE,
        TextQuoteSelector(exact="every stored turbine violently ignites"),
        ResolveOptions(min_confidence=0.5),
    )
    assert result is None


def test_degrades_confidence_as_the_quote_degrades() -> None:
    quote = "A position selector is a promise about a byte layout"
    selector = TextQuoteSelector(exact=quote)
    clean = resolve_quote(ARTICLE, selector)
    noisy = resolve_quote(ARTICLE.replace("promise", "promlse"), selector)
    noisier = resolve_quote(
        ARTICLE.replace("promise about a byte", "promlse aboot a byfe"), selector
    )
    assert clean is not None and noisy is not None and noisier is not None
    assert clean.confidence > noisy.confidence > noisier.confidence


def test_penalizes_a_match_whose_context_did_not_survive() -> None:
    document = "alpha. the quoted passage. omega."
    agreeing = resolve_quote(
        document, TextQuoteSelector(exact="the quoted passage", prefix="alpha. ")
    )
    disagreeing = resolve_quote(
        document,
        TextQuoteSelector(
            exact="the quoted passage", prefix="completely different lead-in "
        ),
    )
    assert agreeing is not None and disagreeing is not None
    assert agreeing.confidence > disagreeing.confidence


def test_honours_max_method_so_callers_can_demand_certainty() -> None:
    edited = ARTICLE.replace("silently rots", "quietly rots")
    selector = TextQuoteSelector(exact="every stored offset silently rots")
    assert resolve_quote(edited, selector) is not None
    assert (
        resolve_quote(edited, selector, ResolveOptions(max_method="normalized")) is None
    )


def test_respects_min_confidence() -> None:
    edited = ARTICLE.replace("silently rots", "quietly rots")
    selector = TextQuoteSelector(exact="every stored offset silently rots")
    assert (
        resolve_quote(edited, selector, ResolveOptions(min_confidence=0.5)) is not None
    )
    assert resolve_quote(edited, selector, ResolveOptions(min_confidence=0.99)) is None


def test_returns_none_for_an_empty_quote() -> None:
    assert resolve_quote(ARTICLE, TextQuoteSelector(exact="")) is None


def test_returns_none_for_an_empty_document() -> None:
    assert resolve_quote("", TextQuoteSelector(exact="anything")) is None


def test_resolves_a_quote_that_spans_the_whole_document() -> None:
    result = resolve_quote(ARTICLE, TextQuoteSelector(exact=ARTICLE))
    assert result is not None
    assert result.start == 0
    assert result.end == len(ARTICLE)


def test_gives_the_same_answer_for_a_prepared_document() -> None:
    prepared = prepare_document(ARTICLE)
    selector = TextQuoteSelector(exact="every stored offset silently rots")
    assert resolve_quote(prepared, selector) == resolve_quote(ARTICLE, selector)


def test_resolves_many_quotes_in_one_pass() -> None:
    results = resolve_quotes(
        ARTICLE,
        [
            TextQuoteSelector(exact="Robust anchoring"),
            TextQuoteSelector(
                exact="not present in this text whatsoever, about turbines"
            ),
            TextQuoteSelector(
                exact="it describes the passage rather than its coordinates"
            ),
        ],
    )
    assert [result is not None for result in results] == [True, False, True]


def test_describe_captures_no_context_for_a_distinctive_quote() -> None:
    selector = describe_quote(ARTICLE, 2, 18)
    assert selector.exact == "Robust anchoring"
    assert selector.prefix == ""
    assert selector.suffix == ""


def test_describe_grows_context_until_a_repeated_quote_is_unique() -> None:
    document = "the cat sat on the mat. the dog sat on the rug."
    at = document.rindex("sat on the")
    selector = describe_quote(document, at, at + len("sat on the"))
    assert selector.prefix != ""
    resolved = resolve_quote(document, selector)
    assert resolved is not None
    assert resolved.start == at
    assert resolved.rivals == ()


def test_describe_stops_growing_at_max_context_length() -> None:
    half = "identical paragraph text repeated verbatim. "
    document = half + half
    selector = describe_quote(
        document,
        len(half),
        len(document),
        DescribeOptions(max_context_length=32),
    )
    assert len(selector.prefix) <= 32


def test_describe_round_trips_for_every_sentence_of_the_article() -> None:
    for sentence in re.split(r"(?<=\.)\s+", ARTICLE):
        at = ARTICLE.index(sentence)
        selector = describe_quote(ARTICLE, at, at + len(sentence))
        resolved = resolve_quote(ARTICLE, selector)
        assert resolved is not None
        assert resolved.start == at
        assert resolved.end == at + len(sentence)
        assert resolved.confidence == 1


def test_describe_round_trips_after_the_document_is_re_typeset() -> None:
    sentence = "Quoted text plus a little context survives most of these changes"
    at = ARTICLE.index(sentence.split("\n")[0])
    selector = describe_quote(ARTICLE, at, at + len(sentence))
    reflowed = re.sub(r" {2,}", " ", ARTICLE.replace("\n", " "))
    resolved = resolve_quote(reflowed, selector)
    assert resolved is not None
    assert "Quoted text plus a little" in reflowed[resolved.start : resolved.end]


def test_describe_describes_an_empty_span_with_context_on_both_sides() -> None:
    selector = describe_quote(ARTICLE, 20, 20)
    assert selector.exact == ""
    assert selector.prefix != ""
    assert selector.suffix != ""


@pytest.mark.parametrize(("start", "end"), [(0, len(ARTICLE) + 1), (5, 4), (-1, 3)])
def test_describe_rejects_a_span_outside_the_document(start: int, end: int) -> None:
    with pytest.raises(ValueError, match="outside the document"):
        describe_quote(ARTICLE, start, end)
