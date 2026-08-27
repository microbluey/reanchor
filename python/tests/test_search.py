"""Tests for exact and approximate substring search."""

from __future__ import annotations

import time

from reanchor import SearchOptions, build_gram_index, find_approximate, find_exact

HAYSTACK = (
    "the quick brown fox jumps over the lazy dog while the slow green turtle "
    "watches from the riverbank"
)


def test_find_exact_finds_every_occurrence_left_to_right() -> None:
    assert find_exact("abcabcabc", "abc") == [0, 3, 6]


def test_find_exact_finds_overlapping_occurrences() -> None:
    assert find_exact("aaaa", "aa") == [0, 1, 2]


def test_find_exact_returns_nothing_for_an_empty_needle() -> None:
    assert find_exact("abc", "") == []


def test_finds_an_exact_occurrence_at_distance_zero() -> None:
    match = find_approximate(HAYSTACK, "brown fox jumps")[0]
    assert match.distance == 0
    assert HAYSTACK[match.start : match.end] == "brown fox jumps"


def test_tolerates_a_substitution() -> None:
    match = find_approximate(HAYSTACK, "brown fix jumps")[0]
    assert match.distance == 1
    assert HAYSTACK[match.start : match.end] == "brown fox jumps"


def test_tolerates_a_deletion() -> None:
    match = find_approximate(HAYSTACK, "brown fox jums")[0]
    assert match.distance == 1
    assert HAYSTACK[match.start : match.end] == "brown fox jumps"


def test_tolerates_an_insertion() -> None:
    match = find_approximate(HAYSTACK, "brown foxx jumps")[0]
    assert match.distance == 1
    assert HAYSTACK[match.start : match.end] == "brown fox jumps"


def test_does_not_let_the_alignment_run_past_the_quote() -> None:
    # Sellers' free end gaps are the point: the window must not swell to the
    # whole seeded region just because the region is long.
    match = find_approximate(HAYSTACK, "lazy dog")[0]
    assert HAYSTACK[match.start : match.end] == "lazy dog"


def test_rejects_a_needle_that_is_not_present() -> None:
    assert find_approximate(HAYSTACK, "electromagnetic interference pattern") == []


def test_respects_max_edit_ratio() -> None:
    strict = SearchOptions(max_edit_ratio=0.05)
    assert find_approximate(HAYSTACK, "brown cat leaps", strict) == []
    assert find_approximate(HAYSTACK, "brown fix jumps", strict) != []


def test_reports_distinct_occurrences_rather_than_neighbouring_alignments() -> None:
    repeated = "alpha beta gamma. filler filler filler. alpha beta gamma."
    matches = find_approximate(repeated, "alpha beta gamma")
    assert len(matches) == 2
    assert sorted(match.start for match in matches) == [
        repeated.index("alpha"),
        repeated.rindex("alpha"),
    ]


def test_orders_results_by_increasing_distance() -> None:
    text = "alpha beta gamma ... filler ... alpha beto gamma"
    matches = find_approximate(text, "alpha beta gamma")
    assert matches[0].distance == 0
    assert matches[1].distance == 1


def test_finds_a_needle_shorter_than_one_seed_by_full_alignment() -> None:
    text = "xxx abc xxx"
    match = find_approximate(text, "ab")[0]
    assert text[match.start : match.end] == "ab"


def test_returns_nothing_for_empty_input() -> None:
    assert find_approximate("", "abc") == []
    assert find_approximate("abc", "") == []


def test_gives_the_same_answer_with_a_prebuilt_index() -> None:
    index = build_gram_index(HAYSTACK)
    assert find_approximate(
        HAYSTACK, "brown fix jumps", SearchOptions(index=index)
    ) == find_approximate(HAYSTACK, "brown fix jumps")


def test_still_finds_a_quote_whose_common_seeds_are_saturated() -> None:
    # ' the ' appears far more than the posting cap allows, so the seed index
    # must not be the only route to a match.
    filler = "the the the the the the the " * 200
    text = f"{filler}distinctive marker sentence here{filler}"
    match = find_approximate(text, "distinctive marker sentence here")[0]
    assert match.distance == 0


def test_scales_to_a_long_document_without_scanning_it_quadratically() -> None:
    paragraph = (
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod. "
    )
    text = paragraph * 4000 + "the needle we are looking for is right here"
    started = time.perf_counter()
    match = find_approximate(text, "the needle we are lokoing for is right here")[0]
    elapsed = time.perf_counter() - started
    assert match.distance <= 2
    # Generous: the point is that the seed filter keeps this off the quadratic
    # path, not that a particular machine hits a particular millisecond count.
    assert elapsed < 5.0
