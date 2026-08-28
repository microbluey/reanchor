/**
 * Quote description — the inverse of resolution.
 *
 * To cite a passage you must first record a selector for it. The quoted text
 * alone is often ambiguous: a document may contain "as discussed above" a
 * dozen times, and a selector that matches all of them tells a later resolver
 * nothing. So context is captured either side.
 *
 * How much context? Fixed-length context is the common answer and it is wrong in
 * one direction: too little to disambiguate a repeated heading. So
 * `describeQuote` grows the context until the selector identifies exactly one
 * location, then stops — repeated passages get just enough.
 *
 * It stops growing, but it does not start at nothing. Recording no context for a
 * quote that is unique today is a bet that it will still be unique when someone
 * comes to resolve it, and that bet loses in a way worth naming: a passage is
 * revised, a verbatim copy of the old wording survives elsewhere as a pull quote
 * or a syndicated excerpt, and the only surviving character-for-character match
 * is the copy. Reported against Hypothesis as
 * [client#7571](https://github.com/hypothesis/client/issues/7571). Context is
 * what tells the revised original from the stale copy, and a selector that
 * recorded none has thrown that evidence away before the ambiguity existed.
 *
 * Context is not free — every recorded character is more surface for a later
 * edit to damage — but the resolver scores context by longest common
 * affix rather than requiring it to match, so partly-edited context degrades
 * a candidate's confidence instead of disqualifying it. A floor therefore costs
 * little and buys the case above.
 */

import { findExact } from "./search.js";

import type { TextQuoteSelector } from "./resolve.js";

export interface DescribeOptions {
  /**
   * Context to record either side, always, and the length to start from when
   * the quote repeats and the context has to grow.
   * @default 16
   */
  minContextLength?: number;
  /**
   * Stop growing here even if the quote is still ambiguous — some documents
   * genuinely repeat a passage verbatim, and unbounded growth would capture
   * whole paragraphs.
   * @default 128
   */
  maxContextLength?: number;
}

/**
 * Build a selector for `document[start..end)`, with enough context to identify
 * it uniquely where possible.
 *
 * Callers that need a guarantee should re-resolve the result: if
 * `resolveQuote` reports rivals, this document repeats the passage beyond
 * `maxContextLength` and position must carry the disambiguation instead.
 */
export function describeQuote(
  document: string,
  start: number,
  end: number,
  options: DescribeOptions = {},
): TextQuoteSelector {
  if (start < 0 || end < start || end > document.length) {
    throw new RangeError(`Span ${start}..${end} is outside the document (length ${document.length})`);
  }

  const exact = document.slice(start, end);
  const minContextLength = options.minContextLength ?? 16;
  const maxContextLength = options.maxContextLength ?? 128;

  const context = (length: number): TextQuoteSelector => ({
    exact,
    prefix: document.slice(Math.max(0, start - length), start),
    suffix: document.slice(end, Math.min(document.length, end + length)),
  });

  if (exact.length === 0) return context(minContextLength);

  const occurrences = findExact(document, exact);
  if (occurrences.length <= 1) return context(minContextLength);

  for (let length = minContextLength; ; length = Math.min(length * 2, maxContextLength)) {
    const selector = context(length);
    const distinct = occurrences.every(
      (at) =>
        at === start ||
        !contextMatches(document, at, at + exact.length, selector.prefix as string, selector.suffix as string),
    );
    if (distinct || length >= maxContextLength) return selector;
  }
}

function contextMatches(
  document: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string,
): boolean {
  if (prefix !== "" && !document.startsWith(prefix, start - prefix.length)) return false;
  if (suffix !== "" && !document.startsWith(suffix, end)) return false;
  return true;
}
