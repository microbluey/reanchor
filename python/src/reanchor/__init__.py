"""reanchor -- find a quote again after the document changed.

Zero dependencies, no filesystem, no network. Give it a string and a
:class:`TextQuoteSelector`; it tells you where the quote is now, or admits it
cannot tell.

    >>> from reanchor import describe_quote, resolve_quote
    >>> document = "The highlight still renders, but over the wrong words."
    >>> selector = describe_quote(document, 4, 19)
    >>> edited = "A note: the highlight quietly renders, but elsewhere."
    >>> found = resolve_quote(edited, selector)
    >>> found.method
    'approximate'
"""

from importlib import metadata as _metadata

from .describe import DescribeOptions, describe_quote
from .normalize import (
    NormalizedText,
    NormalizeOptions,
    Span,
    normalize,
    to_source_span,
)
from .resolve import (
    MatchMethod,
    PreparedDocument,
    ResolvedQuote,
    ResolveOptions,
    TextQuoteSelector,
    prepare_document,
    resolve_quote,
    resolve_quotes,
)
from .search import (
    ApproximateMatch,
    GramIndex,
    SearchOptions,
    build_gram_index,
    find_approximate,
    find_exact,
)

# Read from the installed distribution rather than written here, because a
# literal drifts silently: this said "0.1.0" in the 0.2.0 and 0.3.0 wheels. The
# version lives in `pyproject.toml`, which the release workflow already checks
# against the tag, so metadata is the copy that cannot disagree with the tag.
# A source tree that was never installed has no metadata; say so rather than
# guess a number.
try:
    __version__ = _metadata.version("reanchor")
except _metadata.PackageNotFoundError:  # pragma: no cover - not an installed dist
    __version__ = "0+unknown"

__all__ = [
    "ApproximateMatch",
    "DescribeOptions",
    "GramIndex",
    "MatchMethod",
    "NormalizeOptions",
    "NormalizedText",
    "PreparedDocument",
    "ResolveOptions",
    "ResolvedQuote",
    "SearchOptions",
    "Span",
    "TextQuoteSelector",
    "__version__",
    "build_gram_index",
    "describe_quote",
    "find_approximate",
    "find_exact",
    "normalize",
    "prepare_document",
    "resolve_quote",
    "resolve_quotes",
    "to_source_span",
]
