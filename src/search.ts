/**
 * Approximate substring search.
 *
 * Locating a quote in a document that has since been edited is approximate
 * substring matching: find the window of the haystack whose edit distance to
 * the needle is smallest. Two well-known algorithms are combined here.
 *
 * Sellers' variant of Levenshtein alignment does the actual measuring. It
 * leaves gaps at both ends of the haystack free, so it reports the best
 * *infix* alignment rather than forcing the needle to consume the whole
 * window, and it carries the alignment's origin alongside the cost so the
 * matched window can be recovered without a traceback matrix.
 *
 * Running that over an entire document would cost O(needle x document), so a
 * k-gram diagonal vote narrows the field first: shared k-grams between needle
 * and haystack agree on the offset `position - index` when they belong to the
 * same occurrence, and disagree at random otherwise. Clustering those offsets
 * yields a handful of candidate windows, each of which is then measured
 * exactly. This is the standard seed-and-extend structure, and it keeps the
 * cost proportional to the number of plausible occurrences rather than to
 * document length.
 */

/** Number of characters per seed. Four is short enough to survive an edit every few words. */
const GRAM_SIZE = 4;

/**
 * Seeds occurring more often than this carry no locality information — in a
 * document about anchoring, ` the ` votes for everywhere — so they are skipped.
 */
const MAX_POSTINGS = 256;

/** Never run the quadratic alignment over more than this many windows. */
const DEFAULT_MAX_WINDOWS = 8;

/** Cap on unseeded whole-document alignment, which is quadratic. */
const MAX_UNSEEDED_HAYSTACK = 1 << 20;

export interface GramIndex {
  readonly size: number;
  readonly postings: Map<string, number[]>;
}

export function buildGramIndex(text: string, size = GRAM_SIZE): GramIndex {
  const postings = new Map<string, number[]>();
  for (let i = 0; i + size <= text.length; i++) {
    const gram = text.slice(i, i + size);
    const existing = postings.get(gram);
    if (existing === undefined) {
      postings.set(gram, [i]);
    } else if (existing.length < MAX_POSTINGS) {
      existing.push(i);
    } else if (existing.length === MAX_POSTINGS) {
      // Mark as too common and stop growing it.
      existing.push(-1);
    }
  }
  return { size, postings };
}

export interface ApproximateMatch {
  /** Start of the matched window, in haystack coordinates. */
  readonly start: number;
  /** End of the matched window, in haystack coordinates. */
  readonly end: number;
  /** Levenshtein distance between the needle and that window. */
  readonly distance: number;
}

export interface SearchOptions {
  /**
   * Largest tolerated distance, as a fraction of needle length. Matches worse
   * than this are not returned at all.
   * @default 0.3
   */
  maxEditRatio?: number;
  /** How many candidate windows to align. @default 8 */
  maxWindows?: number;
  /** Prebuilt index over the haystack, to amortize across many needles. */
  index?: GramIndex;
}

/** Every exact occurrence of `needle` in `haystack`, left to right. */
export function findExact(haystack: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const found: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return found;
    found.push(at);
    from = at + 1;
  }
}

/**
 * Best approximate occurrences of `needle`, ordered by increasing distance.
 * Overlapping windows are collapsed to their best representative, so the
 * returned matches are genuinely distinct locations rather than neighbouring
 * alignments of one occurrence.
 */
export function findApproximate(
  haystack: string,
  needle: string,
  options: SearchOptions = {},
): ApproximateMatch[] {
  if (needle.length === 0 || haystack.length === 0) return [];

  const maxEditRatio = options.maxEditRatio ?? 0.3;
  const maxDistance = Math.max(1, Math.floor(needle.length * maxEditRatio));
  const maxWindows = options.maxWindows ?? DEFAULT_MAX_WINDOWS;

  const windows = seedWindows(haystack, needle, maxDistance, maxWindows, options.index);
  if (windows.length === 0) {
    if (haystack.length > MAX_UNSEEDED_HAYSTACK) return [];
    windows.push({ start: 0, end: haystack.length });
  }

  const matches: ApproximateMatch[] = [];
  for (const window of windows) {
    const match = alignInWindow(haystack, needle, window.start, window.end, maxDistance);
    if (match !== null) matches.push(match);
  }

  matches.sort((a, b) => a.distance - b.distance || a.start - b.start);
  return dropOverlapping(matches);
}

interface Window {
  start: number;
  end: number;
}

function seedWindows(
  haystack: string,
  needle: string,
  maxDistance: number,
  maxWindows: number,
  provided: GramIndex | undefined,
): Window[] {
  const index = provided ?? buildGramIndex(haystack);
  if (needle.length < index.size) return [];

  // Vote for candidate offsets. Seeds belonging to one occurrence agree on
  // `position - index` up to the edits between them.
  const votes = new Map<number, number>();
  for (let i = 0; i + index.size <= needle.length; i++) {
    const posting = index.postings.get(needle.slice(i, i + index.size));
    if (posting === undefined) continue;
    if (posting.length > MAX_POSTINGS) continue;
    for (const position of posting) {
      const offset = position - i;
      votes.set(offset, (votes.get(offset) ?? 0) + 1);
    }
  }
  if (votes.size === 0) return [];

  // Cluster nearby offsets: an edit inside the quote shifts the diagonal by
  // one, so the votes for a single occurrence spread over a small range.
  const tolerance = Math.max(index.size, maxDistance);
  const offsets = [...votes.keys()].sort((a, b) => a - b);
  const clusters: { from: number; to: number; weight: number }[] = [];
  let current = { from: offsets[0] as number, to: offsets[0] as number, weight: votes.get(offsets[0] as number) as number };
  for (let i = 1; i < offsets.length; i++) {
    const offset = offsets[i] as number;
    if (offset - current.to <= tolerance) {
      current.to = offset;
      current.weight += votes.get(offset) as number;
    } else {
      clusters.push(current);
      current = { from: offset, to: offset, weight: votes.get(offset) as number };
    }
  }
  clusters.push(current);

  clusters.sort((a, b) => b.weight - a.weight);
  const slack = maxDistance + index.size;
  return clusters.slice(0, maxWindows).map((cluster) => ({
    start: Math.max(0, cluster.from - slack),
    end: Math.min(haystack.length, cluster.to + needle.length + slack),
  }));
}

/**
 * Sellers' algorithm over `haystack[from..to)`: the cost row is seeded with
 * zeros so an alignment may start anywhere, and the origin row records where
 * each alignment began. The minimum of the final row is the best match.
 */
function alignInWindow(
  haystack: string,
  needle: string,
  from: number,
  to: number,
  maxDistance: number,
): ApproximateMatch | null {
  const width = to - from;
  if (width <= 0) return null;

  const ceiling = maxDistance + 1;
  let cost = new Int32Array(width + 1);
  let origin = new Int32Array(width + 1);
  let nextCost = new Int32Array(width + 1);
  let nextOrigin = new Int32Array(width + 1);

  for (let j = 0; j <= width; j++) origin[j] = j;

  for (let i = 1; i <= needle.length; i++) {
    const needleChar = needle.charCodeAt(i - 1);
    nextCost[0] = Math.min(i, ceiling);
    nextOrigin[0] = 0;

    for (let j = 1; j <= width; j++) {
      const substitute = (cost[j - 1] as number) + (haystack.charCodeAt(from + j - 1) === needleChar ? 0 : 1);
      const deleteFromNeedle = (cost[j] as number) + 1;
      const insertFromHaystack = (nextCost[j - 1] as number) + 1;

      let best = substitute;
      let bestOrigin = origin[j - 1] as number;
      if (deleteFromNeedle < best) {
        best = deleteFromNeedle;
        bestOrigin = origin[j] as number;
      }
      if (insertFromHaystack < best) {
        best = insertFromHaystack;
        bestOrigin = nextOrigin[j - 1] as number;
      }

      nextCost[j] = best > ceiling ? ceiling : best;
      nextOrigin[j] = bestOrigin;
    }

    [cost, nextCost] = [nextCost, cost];
    [origin, nextOrigin] = [nextOrigin, origin];
  }

  // Among equal-cost alignments prefer the longest window, hence `<=`. Equal
  // cost means the extra characters were matched rather than paid for, and a
  // resolved quote is usually highlighted for a human: given the choice
  // between "brown fox jumps" and the equally-priced "brown fox jum", the one
  // that does not cut mid-word is the answer the reader expects.
  let bestDistance = ceiling;
  let bestEnd = -1;
  for (let j = 1; j <= width; j++) {
    const distance = cost[j] as number;
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestEnd = j;
    }
  }
  if (bestEnd < 0 || bestDistance > maxDistance) return null;

  return {
    start: from + (origin[bestEnd] as number),
    end: from + bestEnd,
    distance: bestDistance,
  };
}

/** Keep the best match of each overlapping group; input must be sorted by distance. */
function dropOverlapping(matches: ApproximateMatch[]): ApproximateMatch[] {
  const kept: ApproximateMatch[] = [];
  for (const match of matches) {
    const overlaps = kept.some((other) => match.start < other.end && other.start < match.end);
    if (!overlaps) kept.push(match);
  }
  return kept;
}
