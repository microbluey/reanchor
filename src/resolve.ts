/**
 * Quote resolution.
 *
 * Given a W3C-style TextQuoteSelector — the quoted text plus a little context
 * either side — and a document that may have changed since the quote was
 * taken, find where the quote lives now.
 *
 * The strategy is a ladder, cheapest and most trustworthy rung first:
 *
 *   1. Exact match of quote plus context, in the raw document.
 *   2. Exact match of the quote alone; context disambiguates between hits.
 *   3. Steps 1-2 again over normalized text, which absorbs re-typeset
 *      whitespace, curly quotes, and hyphenated line breaks.
 *   4. Approximate match over normalized text, for genuine edits and OCR
 *      noise, scored by both quote distance and how well the context survived.
 *
 * A resolver's most important property is knowing when it has failed. Every
 * result therefore carries the rung that produced it and a confidence, and
 * `resolveQuote` returns `null` rather than the least-bad window when nothing
 * clears the threshold. A silently wrong citation is worse than an absent one:
 * it looks verified.
 */

import { type NormalizedText, normalize, type NormalizeOptions, toSourceSpan } from "./normalize.js";
import { buildGramIndex, findApproximate, findExact, type GramIndex } from "./search.js";

export interface TextQuoteSelector {
  /** The quoted text. */
  readonly exact: string;
  /** Text immediately before the quote, if it was captured. */
  readonly prefix?: string;
  /** Text immediately after the quote, if it was captured. */
  readonly suffix?: string;
}

/**
 * The rung of the ladder that produced a match, from most to least
 * trustworthy. Callers that must not show a wrong citation can require
 * `exact-with-context`; callers that prefer a probably-right location to none
 * can accept `approximate`.
 */
export type MatchMethod =
  | "exact-with-context"
  | "exact"
  | "normalized-with-context"
  | "normalized"
  | "approximate";

export interface ResolvedQuote {
  /** Start of the quote in the document, as a string index. */
  readonly start: number;
  /** End of the quote in the document, as a string index. */
  readonly end: number;
  /** The document text actually spanned, useful for display and assertions. */
  readonly text: string;
  /** Which rung produced this match. */
  readonly method: MatchMethod;
  /**
   * How much to trust this match, in `(0, 1]`. Exact matches with agreeing
   * context score 1. Approximate matches are penalized by their edit distance
   * and by context that failed to survive.
   */
  readonly confidence: number;
  /** Levenshtein distance to the quote, measured on normalized text. */
  readonly distance: number;
  /**
   * Other locations that matched comparably well. A non-empty value means the
   * document repeats this passage and the context was not enough to tell the
   * copies apart; treat the primary result with suspicion.
   */
  readonly rivals: readonly Omit<ResolvedQuote, "rivals">[];
}

export interface ResolveOptions {
  /**
   * Reject matches below this confidence. The default admits substantial
   * editing while still refusing near-noise.
   * @default 0.5
   */
  minConfidence?: number;
  /**
   * Largest tolerated edit distance for the approximate rung, as a fraction of
   * quote length. Above roughly 0.4 the matches stop being the same sentence.
   * @default 0.3
   */
  maxEditRatio?: number;
  /**
   * How many characters of context to weigh either side. Longer context
   * disambiguates repeated passages better but is likelier to have been
   * edited itself.
   * @default 32
   */
  contextLength?: number;
  /** Stop at this rung; lower rungs are not attempted. @default "approximate" */
  maxMethod?: MatchMethod;
  /** Overrides for normalization, which must agree with any prepared document. */
  normalize?: NormalizeOptions;
  /** How many rivals to report. @default 3 */
  maxRivals?: number;
}

/**
 * A document with its normalization and seed index computed once. Resolving
 * many quotes against one document — the usual case for a citation checker —
 * should reuse this rather than re-normalizing per quote.
 */
export interface PreparedDocument {
  readonly text: string;
  readonly normalized: NormalizedText;
  readonly index: GramIndex;
  readonly options: NormalizeOptions;
}

const METHOD_ORDER: readonly MatchMethod[] = [
  "exact-with-context",
  "exact",
  "normalized-with-context",
  "normalized",
  "approximate",
];

/**
 * Confidence awarded by each rung before context and ambiguity adjustments.
 *
 * The exact rungs score 1: the quote was found character for character, and a
 * selector that recorded no context is not thereby less certain. The
 * normalized rungs give up a little because normalization can in principle
 * conflate texts that differ — `café` and `cafe` reach the same needle. The
 * approximate rung starts lower still and is then scaled by similarity.
 */
const METHOD_CONFIDENCE: Record<MatchMethod, number> = {
  "exact-with-context": 1,
  exact: 1,
  "normalized-with-context": 0.98,
  normalized: 0.98,
  approximate: 0.95,
};

/** Applied to a candidate its own rung could not single out — see `penalizeAmbiguous`. */
const AMBIGUITY_PENALTY = 0.8;

/** Confidences within this distance count as tied, so neither wins on rounding. */
const TIE_EPSILON = 1e-9;

/**
 * Floor of the context factor: a match whose recorded context is entirely
 * absent from the document keeps this fraction of its confidence.
 */
const CONTEXT_WEIGHT = 0.7;

export function prepareDocument(text: string, options: NormalizeOptions = {}): PreparedDocument {
  const normalized = normalize(text, options);
  return { text, normalized, index: buildGramIndex(normalized.text), options };
}

/**
 * Locate `selector` in `document`, or return `null` if it cannot be found with
 * enough confidence.
 */
export function resolveQuote(
  document: string | PreparedDocument,
  selector: TextQuoteSelector,
  options: ResolveOptions = {},
): ResolvedQuote | null {
  if (selector.exact.length === 0) return null;

  const minConfidence = options.minConfidence ?? 0.5;
  const contextLength = options.contextLength ?? 32;
  const maxRivals = options.maxRivals ?? 3;
  const limit = METHOD_ORDER.indexOf(options.maxMethod ?? "approximate");

  const prepared =
    typeof document === "string" ? prepareDocument(document, options.normalize ?? {}) : document;
  const prefix = clipEnd(selector.prefix ?? "", contextLength);
  const suffix = clipStart(selector.suffix ?? "", contextLength);

  const candidates: Candidate[] = [];
  for (let rung = 0; rung <= limit; rung++) {
    const method = METHOD_ORDER[rung] as MatchMethod;
    candidates.push(
      ...penalizeAmbiguous(attempt(method, prepared, selector, prefix, suffix, options)),
    );
    if (candidates.length > 0 && !canBeBeaten(candidates, rung, limit)) break;
  }
  if (candidates.length === 0) return null;

  // One location can be reached by several rungs — the exact rung and the
  // normalized rung find the same span whenever normalization changed nothing
  // relevant. Keep each location once, at its best score, so that a span cannot
  // appear as a rival to itself.
  const byLocation = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = `${candidate.start}:${candidate.end}`;
    const seen = byLocation.get(key);
    if (seen === undefined || candidate.confidence > seen.confidence) byLocation.set(key, candidate);
  }
  const distinct = [...byLocation.values()];

  distinct.sort((a, b) => b.confidence - a.confidence || a.start - b.start);
  const best = distinct[0] as Candidate;
  if (best.confidence < minConfidence) return null;

  const rivals = distinct
    .slice(1)
    .filter((candidate) => candidate.confidence >= minConfidence && candidate.confidence >= best.confidence - 0.05)
    .slice(0, maxRivals)
    .map((candidate) => materialize(candidate, prepared.text));

  return { ...materialize(best, prepared.text), rivals };
}

/**
 * Whether a rung below `rung` could still produce a better answer than what has
 * been found so far.
 *
 * The ladder is ordered by trustworthiness, so the obvious implementation stops
 * at the first rung that yields anything. That is wrong when the quote survives
 * verbatim somewhere it does not belong: a decoy found by the exact rung whose
 * surroundings bear no resemblance to the recorded context scores *below* what
 * the approximate rung can award the copy-edited original, whose surroundings
 * still match. Stopping early means those two candidates are never compared.
 *
 * So descend while the best score so far is under the ceiling a lower rung could
 * reach — its base confidence, since similarity, context agreement and the
 * ambiguity penalty can only reduce it. A match with fully agreeing context
 * scores its rung's base confidence, which is at or above every lower rung's
 * ceiling, so the unambiguous case still stops at the first rung and costs
 * nothing.
 */
function canBeBeaten(candidates: readonly Candidate[], rung: number, limit: number): boolean {
  let ceiling = 0;
  for (let next = rung + 1; next <= limit; next++) {
    ceiling = Math.max(ceiling, METHOD_CONFIDENCE[METHOD_ORDER[next] as MatchMethod]);
  }
  let best = 0;
  for (const candidate of candidates) best = Math.max(best, candidate.confidence);
  return best < ceiling;
}

/**
 * Discount candidates that their own rung could not single out.
 *
 * Counting hits is the tempting test, and it is the wrong one: a rung that found
 * three locations but whose recorded context matches exactly one of them *has*
 * told them apart, and penalizing the survivor for the company it kept lets a
 * worse rung's unambiguous-but-wrong answer outrank it. What ambiguity should
 * cost is being indistinguishable, so the penalty falls on candidates tied at the
 * top of their rung — where the resolver is genuinely choosing by coin flip —
 * and a candidate that context put in front on its own keeps its score.
 *
 * A single hit is trivially in front and so passes through unchanged, which is
 * why this is not a behaviour change for the common case.
 */
function penalizeAmbiguous(candidates: readonly Candidate[]): Candidate[] {
  if (candidates.length <= 1) return [...candidates];
  let best = 0;
  for (const candidate of candidates) best = Math.max(best, candidate.confidence);
  const tied = candidates.filter((candidate) => candidate.confidence >= best - TIE_EPSILON).length;
  if (tied <= 1) return [...candidates];
  return candidates.map((candidate) =>
    candidate.confidence >= best - TIE_EPSILON
      ? { ...candidate, confidence: candidate.confidence * AMBIGUITY_PENALTY }
      : candidate,
  );
}

/**
 * Resolve many quotes against one document. Equivalent to calling
 * `resolveQuote` per selector, but normalizes and indexes the document once.
 */
export function resolveQuotes(
  document: string,
  selectors: readonly TextQuoteSelector[],
  options: ResolveOptions = {},
): (ResolvedQuote | null)[] {
  const prepared = prepareDocument(document, options.normalize ?? {});
  return selectors.map((selector) => resolveQuote(prepared, selector, options));
}

interface Candidate {
  start: number;
  end: number;
  method: MatchMethod;
  confidence: number;
  distance: number;
}

function attempt(
  method: MatchMethod,
  prepared: PreparedDocument,
  selector: TextQuoteSelector,
  prefix: string,
  suffix: string,
  options: ResolveOptions,
): Candidate[] {
  switch (method) {
    case "exact-with-context": {
      if (prefix === "" && suffix === "") return [];
      const joined = prefix + selector.exact + suffix;
      return findExact(prepared.text, joined).map((at) => ({
        start: at + prefix.length,
        end: at + prefix.length + selector.exact.length,
        method,
        confidence: METHOD_CONFIDENCE[method],
        distance: 0,
      }));
    }

    case "exact": {
      const hits = findExact(prepared.text, selector.exact);
      if (hits.length === 0) return [];
      return hits.map((at) => ({
        start: at,
        end: at + selector.exact.length,
        method,
        confidence: score(
          METHOD_CONFIDENCE[method],
          contextAgreement(prepared.text, at, at + selector.exact.length, prefix, suffix),
        ),
        distance: 0,
      }));
    }

    case "normalized-with-context":
    case "normalized": {
      const withContext = method === "normalized-with-context";
      if (withContext && prefix === "" && suffix === "") return [];
      const normalizedQuote = normalize(selector.exact, prepared.options).text;
      if (normalizedQuote === "") return [];
      const needle = withContext
        ? normalize(prefix + selector.exact + suffix, prepared.options).text
        : normalizedQuote;
      if (needle === "") return [];

      // Normalization can shift where the quote sits inside the joined needle,
      // so locate it rather than assuming the prefix length carried over.
      const offset = withContext ? needle.indexOf(normalizedQuote) : 0;
      if (offset < 0) return [];

      const hits = findExact(prepared.normalized.text, needle);
      return hits.map((at) => {
        const span = toSourceSpan(prepared.normalized, at + offset, at + offset + normalizedQuote.length);
        const agreement = withContext
          ? 1
          : contextAgreement(prepared.text, span.start, span.end, prefix, suffix);
        return {
          start: span.start,
          end: span.end,
          method,
          confidence: score(METHOD_CONFIDENCE[method], agreement),
          distance: 0,
        };
      });
    }

    case "approximate": {
      const normalizedQuote = normalize(selector.exact, prepared.options).text;
      if (normalizedQuote === "") return [];
      const matches = findApproximate(prepared.normalized.text, normalizedQuote, {
        maxEditRatio: options.maxEditRatio ?? 0.3,
        index: prepared.index,
      });
      return matches.map((match) => {
        const span = toSourceSpan(prepared.normalized, match.start, match.end);
        const similarity = 1 - match.distance / Math.max(normalizedQuote.length, 1);
        const agreement = contextAgreement(prepared.text, span.start, span.end, prefix, suffix);
        return {
          start: span.start,
          end: span.end,
          method,
          confidence: score(METHOD_CONFIDENCE[method] * similarity, agreement),
          distance: match.distance,
        };
      });
    }
  }
}

/**
 * Combine a rung's base confidence with how well the context survived.
 *
 * Context agreement asks whether the surroundings still look like the ones
 * recorded — a selector that recorded no context scores 1 here, because absent
 * evidence is not evidence against. Whether the rung could tell this location
 * apart from the others it found is a separate question, answered afterwards by
 * `penalizeAmbiguous`, once every candidate on the rung has been scored and it
 * is possible to see whether context put one of them in front.
 */
function score(base: number, agreement: number): number {
  return base * (CONTEXT_WEIGHT + (1 - CONTEXT_WEIGHT) * agreement);
}

/**
 * How well the text around a candidate matches the recorded context, in
 * `[0, 1]`. Scored on normalized text so that re-typesetting does not read as
 * disagreement, and by longest common suffix/prefix so that context which was
 * itself partly edited still contributes. With no recorded context the answer
 * is 1: absent evidence is not evidence against.
 */
function contextAgreement(
  document: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string,
): number {
  let total = 0;
  let score = 0;

  if (prefix !== "") {
    const before = normalize(document.slice(Math.max(0, start - prefix.length * 2), start)).text;
    const want = normalize(prefix).text;
    total += want.length;
    score += commonSuffixLength(before, want);
  }
  if (suffix !== "") {
    const after = normalize(document.slice(end, Math.min(document.length, end + suffix.length * 2))).text;
    const want = normalize(suffix).text;
    total += want.length;
    score += commonPrefixLength(after, want);
  }
  return total === 0 ? 1 : score / total;
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

function commonSuffixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++;
  return i;
}

function materialize(candidate: Candidate, document: string): Omit<ResolvedQuote, "rivals"> {
  return {
    start: candidate.start,
    end: candidate.end,
    text: document.slice(candidate.start, candidate.end),
    method: candidate.method,
    confidence: Math.min(1, Math.round(candidate.confidence * 1e6) / 1e6),
    distance: candidate.distance,
  };
}

function clipEnd(value: string, length: number): string {
  return value.length <= length ? value : value.slice(value.length - length);
}

function clipStart(value: string, length: number): string {
  return value.length <= length ? value : value.slice(0, length);
}
