"""Tests for offset-preserving normalization.

The offset map is the load-bearing part of this module: a resolver that matches
on normalized text but reports offsets into it produces citations that
highlight the wrong characters. So most of these tests assert on
``to_source_span`` round-trips rather than on the normalized string alone.
"""

from __future__ import annotations

import pytest

from reanchor import NormalizeOptions, Span, normalize, to_source_span

# Spelled by codepoint rather than pasted: these three are invisible, and a
# test whose input cannot be read is a test whose failure cannot be diagnosed.
SOFT_HYPHEN = chr(0x00AD)
ZERO_WIDTH_SPACE = chr(0x200B)
BYTE_ORDER_MARK = chr(0xFEFF)


def test_collapses_whitespace_runs_to_a_single_space() -> None:
    assert normalize("a  \n\t b").text == "a b"


def test_maps_a_collapsed_run_back_to_the_whole_run() -> None:
    normalized = normalize("a  \n\t b")
    space = normalized.text.index(" ")
    assert to_source_span(normalized, space, space + 1) == Span(1, 6)


def test_trims_the_ends_without_shifting_interior_offsets() -> None:
    source = "   hello world   "
    normalized = normalize(source)
    assert normalized.text == "hello world"
    assert to_source_span(normalized, 0, 5) == Span(3, 8)
    assert source[3:8] == "hello"


def test_folds_typographic_quotes_and_dashes_to_ascii() -> None:
    assert normalize("“wait—no”, she said’s").text == ('"wait-no", she said\'s')


def test_expands_the_ellipsis_so_the_two_spellings_converge() -> None:
    assert normalize("wait…").text == normalize("wait...").text


def test_maps_every_character_of_a_multi_character_fold_to_one_source_point() -> None:
    normalized = normalize("a…b")
    assert normalized.text == "a...b"
    # All three dots came from the single ellipsis at source index 1.
    assert to_source_span(normalized, 1, 4) == Span(1, 2)
    assert to_source_span(normalized, 2, 3) == Span(1, 2)


def test_strips_combining_marks_left_by_decomposition() -> None:
    assert normalize("café").text == "cafe"  # precomposed
    assert normalize("café").text == "cafe"  # decomposed


def test_folds_compatibility_forms() -> None:
    assert normalize("Ｈｅｌｌｏ").text == "hello"
    assert normalize("ﬁne").text == "fine"


def test_drops_zero_width_characters_including_the_soft_hyphen() -> None:
    source = f"a{ZERO_WIDTH_SPACE}b{SOFT_HYPHEN}c{BYTE_ORDER_MARK}d"
    assert normalize(source).text == "abcd"


def test_joins_words_broken_across_a_line_by_a_hyphen() -> None:
    assert normalize("exam-\nple").text == "example"
    assert normalize("exam-\r\n   ple").text == "example"


def test_keeps_a_hyphen_that_is_not_a_line_break() -> None:
    assert normalize("well-known").text == "well-known"
    assert normalize("exam- ple").text == "exam- ple"


def test_keeps_a_trailing_hyphen_at_the_very_end_of_the_text() -> None:
    assert normalize("exam-\n").text == "exam-"


def test_keeps_a_hyphen_before_a_line_break_that_resumes_with_punctuation() -> None:
    assert normalize("exam-\n(ple)").text == "exam- (ple)"


def test_maps_the_joined_halves_back_to_their_own_source_ranges() -> None:
    source = "exam-\nple done"
    normalized = normalize(source)
    assert normalized.text == "example done"
    assert to_source_span(normalized, 0, 7) == Span(0, 9)
    assert source[0:9] == "exam-\nple"


def test_maps_every_normalized_character_to_a_non_empty_source_range() -> None:
    source = f"  A{SOFT_HYPHEN}“B—c… \n dｅf  "
    normalized = normalize(source)
    for i in range(len(normalized.text)):
        span = to_source_span(normalized, i, i + 1)
        assert span.end > span.start
        assert span.start >= 0
        assert span.end <= len(source)


def test_produces_monotonically_non_decreasing_source_offsets() -> None:
    normalized = normalize("The “quick” brown—fox jumps\nover  the lazy dog.")
    for i in range(1, len(normalized.text)):
        assert normalized.src_start[i] >= normalized.src_start[i - 1]
        assert normalized.src_end[i] >= normalized.src_end[i - 1]


def test_treats_an_astral_character_as_one_index() -> None:
    # Where JavaScript would report a two-unit span, Python reports one code
    # point. This asymmetry is documented, not accidental: the two
    # implementations agree within the BMP and diverge past it.
    source = "a\U0001f600b"
    normalized = normalize(source)
    emoji = normalized.text.index("\U0001f600")
    assert to_source_span(normalized, emoji, emoji + 1) == Span(1, 2)


def test_respects_disabled_options() -> None:
    assert normalize("A  B", NormalizeOptions(case_fold=False)).text == "A B"
    assert normalize("A  B", NormalizeOptions(collapse_whitespace=False)).text == "a  b"
    assert normalize(" ab ", NormalizeOptions(trim=False)).text == " ab "
    assert normalize("café", NormalizeOptions(strip_marks=False)).text == "café"
    assert normalize("a—b", NormalizeOptions(fold_punctuation=False)).text == "a—b"


def test_returns_an_empty_result_for_whitespace_only_input() -> None:
    normalized = normalize("   \n  ")
    assert normalized.text == ""
    assert to_source_span(normalized, 0, 0) == Span(6, 6)


def test_collapses_an_empty_span_to_the_start_of_its_character() -> None:
    normalized = normalize("  hello")
    assert to_source_span(normalized, 1, 1) == Span(3, 3)


@pytest.mark.parametrize(("start", "end"), [(0, 6), (3, 2), (-1, 1)])
def test_rejects_spans_outside_the_normalized_text(start: int, end: int) -> None:
    normalized = normalize("hello")
    with pytest.raises(ValueError, match="outside the normalized text"):
        to_source_span(normalized, start, end)


def test_is_idempotent() -> None:
    once = normalize("The “quick—brown” fox… café  \n jumps").text
    assert normalize(once).text == once
