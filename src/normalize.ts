/**
 * Offset-preserving text normalization.
 *
 * Two copies of "the same" text rarely agree byte for byte. A PDF re-extracted
 * with a different tool hyphenates across line breaks; a CMS turns straight
 * quotes into curly ones; an editor rewraps paragraphs. Comparing such texts
 * requires normalizing both sides — but a quote resolver must then report
 * offsets in the *original* string, not the normalized one.
 *
 * `normalize` therefore returns, alongside the normalized text, the source
 * range that produced each normalized character. `toSourceSpan` maps a span
 * back. Every transformation here is deliberately offset-attributable: one
 * source code point maps to zero or more normalized characters, and a run of
 * collapsed whitespace maps to a single space that spans the whole run.
 */

export interface NormalizeOptions {
  /**
   * Apply per-code-point Unicode NFKD. Decomposing (rather than composing)
   * makes precomposed and combining forms of the same grapheme converge, and
   * folds compatibility characters such as ligatures and full-width Latin.
   * @default true
   */
  unicode?: boolean;
  /**
   * Drop combining marks left behind by decomposition, so that `café` and
   * `cafe` compare equal. Only meaningful with `unicode`.
   * @default true
   */
  stripMarks?: boolean;
  /** Lowercase the result. @default true */
  caseFold?: boolean;
  /**
   * Fold typographic punctuation onto its ASCII equivalent: every dash to
   * `-`, every quotation mark to `'` or `"`, the ellipsis to `...`.
   * @default true
   */
  foldPunctuation?: boolean;
  /** Collapse each run of whitespace to a single space. @default true */
  collapseWhitespace?: boolean;
  /**
   * Join words broken across a line by a hyphen: `exam-\nple` becomes
   * `example`. Applies only when the hyphen sits between two letters and the
   * intervening whitespace contains a line break.
   * @default true
   */
  joinHyphenatedLineBreaks?: boolean;
  /** Drop leading and trailing whitespace. @default true */
  trim?: boolean;
}

export interface NormalizedText {
  /** The normalized text. */
  readonly text: string;
  /** `srcStart[i]` is where the source range for normalized character `i` begins. */
  readonly srcStart: Int32Array;
  /** `srcEnd[i]` is just past the source range for normalized character `i`. */
  readonly srcEnd: Int32Array;
  /** Length of the string this was normalized from. */
  readonly sourceLength: number;
}

export interface Span {
  readonly start: number;
  readonly end: number;
}

const DEFAULTS: Required<NormalizeOptions> = {
  unicode: true,
  stripMarks: true,
  caseFold: true,
  foldPunctuation: true,
  collapseWhitespace: true,
  joinHyphenatedLineBreaks: true,
  trim: true,
};

/** Characters that carry no visible width and should never affect matching. */
const ZERO_WIDTH = new Set([0x00ad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

const PUNCTUATION_FOLD = new Map<number, string>([
  // Dashes, hyphens, and minus signs.
  [0x2010, "-"],
  [0x2011, "-"],
  [0x2012, "-"],
  [0x2013, "-"],
  [0x2014, "-"],
  [0x2015, "-"],
  [0x2043, "-"],
  [0x2212, "-"],
  [0xfe58, "-"],
  [0xfe63, "-"],
  [0xff0d, "-"],
  // Single quotation marks, primes, and apostrophes.
  [0x2018, "'"],
  [0x2019, "'"],
  [0x201a, "'"],
  [0x201b, "'"],
  [0x2032, "'"],
  [0x2035, "'"],
  [0x00b4, "'"],
  [0x02bc, "'"],
  [0xff07, "'"],
  // Double quotation marks and guillemets.
  [0x201c, '"'],
  [0x201d, '"'],
  [0x201e, '"'],
  [0x201f, '"'],
  [0x2033, '"'],
  [0x2036, '"'],
  [0x00ab, '"'],
  [0x00bb, '"'],
  [0x301d, '"'],
  [0x301e, '"'],
  [0xff02, '"'],
  // Ellipsis expands so that `…` and `...` converge.
  [0x2026, "..."],
]);

const COMBINING_MARK = /\p{M}/u;
const LETTER = /\p{L}/u;

function isWhitespaceCode(cp: number): boolean {
  return (
    cp === 0x20 ||
    (cp >= 0x09 && cp <= 0x0d) ||
    cp === 0x85 ||
    cp === 0xa0 ||
    cp === 0x1680 ||
    (cp >= 0x2000 && cp <= 0x200a) ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    cp === 0x202f ||
    cp === 0x205f ||
    cp === 0x3000
  );
}

function isLineBreakCode(cp: number): boolean {
  return cp === 0x0a || cp === 0x0b || cp === 0x0c || cp === 0x0d || cp === 0x85 || cp === 0x2028 || cp === 0x2029;
}

function isDashCode(cp: number): boolean {
  return cp === 0x2d || PUNCTUATION_FOLD.get(cp) === "-";
}

export function normalize(source: string, options: NormalizeOptions = {}): NormalizedText {
  const opts = { ...DEFAULTS, ...options };
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];

  // A run of source whitespace is held back until we know whether anything
  // follows it, so that trailing whitespace can be dropped without a second
  // pass and so that a collapsed space can span the entire run.
  let pendingStart = -1;
  let pendingEnd = -1;

  // Emission is per UTF-16 code unit, not per code point: the offset arrays
  // are indexed the same way JavaScript indexes strings, so an astral
  // character must occupy two entries or every later index is off by one.
  const emit = (value: string, from: number, to: number): void => {
    for (let k = 0; k < value.length; k++) {
      chars.push(value.charAt(k));
      starts.push(from);
      ends.push(to);
    }
  };

  const flushWhitespace = (atEnd: boolean): void => {
    if (pendingStart < 0) return;
    const leading = chars.length === 0;
    if (!(opts.trim && (leading || atEnd))) {
      if (opts.collapseWhitespace) {
        emit(" ", pendingStart, pendingEnd);
      } else {
        for (let k = pendingStart; k < pendingEnd; ) {
          const cp = source.codePointAt(k) as number;
          const width = cp > 0xffff ? 2 : 1;
          emit(" ", k, k + width);
          k += width;
        }
      }
    }
    pendingStart = -1;
    pendingEnd = -1;
  };

  for (let i = 0; i < source.length; ) {
    const cp = source.codePointAt(i) as number;
    const width = cp > 0xffff ? 2 : 1;
    const next = i + width;

    if (ZERO_WIDTH.has(cp)) {
      i = next;
      continue;
    }

    if (isWhitespaceCode(cp)) {
      if (pendingStart < 0) pendingStart = i;
      pendingEnd = next;
      i = next;
      continue;
    }

    if (opts.joinHyphenatedLineBreaks && isDashCode(cp) && pendingStart < 0) {
      const joined = tryJoinHyphenatedBreak(source, next, chars);
      if (joined >= 0) {
        i = joined;
        continue;
      }
    }

    flushWhitespace(false);

    const raw = source.slice(i, next);
    let folded = opts.foldPunctuation ? PUNCTUATION_FOLD.get(cp) : undefined;
    if (folded === undefined) {
      folded = opts.unicode ? raw.normalize("NFKD") : raw;
      if (opts.stripMarks) folded = stripCombiningMarks(folded);
    }
    if (opts.caseFold) folded = folded.toLowerCase();
    emit(folded, i, next);
    i = next;
  }

  flushWhitespace(true);

  return {
    text: chars.join(""),
    srcStart: Int32Array.from(starts),
    srcEnd: Int32Array.from(ends),
    sourceLength: source.length,
  };
}

/**
 * If the hyphen just consumed breaks a word across a line, return the source
 * index to resume from — past the hyphen and the intervening whitespace.
 * Returns -1 when this is an ordinary hyphen that must be kept.
 */
function tryJoinHyphenatedBreak(source: string, from: number, emitted: string[]): number {
  const previous = emitted[emitted.length - 1];
  if (previous === undefined || !LETTER.test(previous)) return -1;

  let k = from;
  let sawLineBreak = false;
  while (k < source.length) {
    const cp = source.codePointAt(k) as number;
    if (ZERO_WIDTH.has(cp)) {
      k += cp > 0xffff ? 2 : 1;
      continue;
    }
    if (!isWhitespaceCode(cp)) break;
    if (isLineBreakCode(cp)) sawLineBreak = true;
    k += cp > 0xffff ? 2 : 1;
  }
  if (!sawLineBreak || k >= source.length) return -1;

  const following = source.codePointAt(k) as number;
  if (!LETTER.test(String.fromCodePoint(following))) return -1;
  return k;
}

function stripCombiningMarks(value: string): string {
  if (!COMBINING_MARK.test(value)) return value;
  let out = "";
  for (const char of value) {
    if (!COMBINING_MARK.test(char)) out += char;
  }
  return out;
}

/**
 * Map a span of normalized text back to the source string it came from.
 *
 * An empty span collapses to the source position where the normalized
 * character at `start` begins, or to the end of the source when `start` is
 * past the last normalized character.
 */
export function toSourceSpan(normalized: NormalizedText, start: number, end: number): Span {
  const length = normalized.text.length;
  if (start < 0 || end < start || end > length) {
    throw new RangeError(`Span ${start}..${end} is outside the normalized text (length ${length})`);
  }
  if (start === length) {
    return { start: normalized.sourceLength, end: normalized.sourceLength };
  }
  const sourceStart = normalized.srcStart[start] as number;
  if (end === start) return { start: sourceStart, end: sourceStart };
  return { start: sourceStart, end: normalized.srcEnd[end - 1] as number };
}
