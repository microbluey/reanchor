/**
 * Quote description — the inverse of resolution.
 *
 * To cite a passage you must first record a selector for it. The quoted text
 * alone is often ambiguous: a document may contain "as discussed above" a
 * dozen times, and a selector that matches all of them tells a later resolver
 * nothing. So context is captured either side.
 *
 * How much context? Fixed-length context is the common answer and it is
 * wrong in both directions: too little to disambiguate a repeated heading, and
 * needlessly long for a distinctive sentence — where the extra characters are
 * simply more surface area for a later edit to damage. `describeQuote` instead
 * grows the context until the selector identifies exactly one location, then
 * stops. Distinctive quotes get no context; repeated ones get just enough.
 */

import { findExact } from "./search.js";

import type { TextQuoteSelector } from "./resolve.js";

export interface DescribeOptions {
  /**
   * Context length to start from, doubling until the selector is unique.
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

  if (exact.length === 0) {
    return {
      exact,
      prefix: document.slice(Math.max(0, start - minContextLength), start),
      suffix: document.slice(end, Math.min(document.length, end + minContextLength)),
    };
  }

  const occurrences = findExact(document, exact);
  if (occurrences.length <= 1) return { exact, prefix: "", suffix: "" };

  for (let length = minContextLength; ; length = Math.min(length * 2, maxContextLength)) {
    const prefix = document.slice(Math.max(0, start - length), start);
    const suffix = document.slice(end, Math.min(document.length, end + length));
    const distinct = occurrences.every(
      (at) => at === start || !contextMatches(document, at, at + exact.length, prefix, suffix),
    );
    if (distinct || length >= maxContextLength) return { exact, prefix, suffix };
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
