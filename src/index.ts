/**
 * reanchor — find a quote again after the document changed.
 *
 * Zero dependencies, no DOM, no filesystem. Give it a string and a
 * TextQuoteSelector; it tells you where the quote is now, or admits it cannot
 * tell.
 */

export {
  normalize,
  toSourceSpan,
  type NormalizedText,
  type NormalizeOptions,
  type Span,
} from "./normalize.js";

export {
  buildGramIndex,
  findApproximate,
  findExact,
  type ApproximateMatch,
  type GramIndex,
  type SearchOptions,
} from "./search.js";

export {
  prepareDocument,
  resolveQuote,
  resolveQuotes,
  type MatchMethod,
  type PreparedDocument,
  type ResolvedQuote,
  type ResolveOptions,
  type TextQuoteSelector,
} from "./resolve.js";

export { describeQuote, type DescribeOptions } from "./describe.js";
