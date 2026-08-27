/**
 * A benchmark corpus with mechanically known answers.
 *
 * Anchoring is one of the rare retrieval-adjacent problems that needs no human
 * labels. Take a document, record a selector for a known span, then mutate the
 * document by a transformation whose effect on that span you can compute. The
 * ground truth is not a judgement call: it is the span the mutation moved the
 * original text to.
 *
 * That makes claims about this library falsifiable. `npm run bench` reports
 * recall and mislocation rate per mutation class, so a regression shows up as a
 * number rather than as a broken feeling.
 *
 * Everything here is deterministic — a seeded generator, no wall clock — so two
 * runs on two machines produce the same corpus and comparable numbers.
 */

export interface Mutation {
  readonly name: string;
  /**
   * Rewrite the document. Returns the new document plus the new location of
   * the span that was at `[start, end)`, or `null` if this mutation destroyed
   * the span — in which case the resolver is expected to return no match.
   */
  readonly apply: (
    document: string,
    span: { start: number; end: number },
    random: () => number,
  ) => { document: string; expected: { start: number; end: number } | null } | null;
}

/** xorshift32: small, deterministic, adequate for choosing mutation sites. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/**
 * Replace text outside the span. The span's content is untouched, but every
 * offset after the edit shifts — which is exactly the failure mode that
 * position-only anchors have and quote anchors should not.
 */
const editOutsideSpan: Mutation = {
  name: "edit-outside-span",
  apply(document, span, random) {
    const insertAt = Math.floor(random() * span.start);
    const inserted = "\n\nAn inserted paragraph, added by a later editor.\n\n";
    return {
      document: document.slice(0, insertAt) + inserted + document.slice(insertAt),
      expected: { start: span.start + inserted.length, end: span.end + inserted.length },
    };
  },
};

/** Re-wrap the document, as a PDF re-export or a CMS migration would. */
const reflowWhitespace: Mutation = {
  name: "reflow-whitespace",
  apply(document, span) {
    const rewrap = (value: string): string => value.replace(/\s+/g, " ");
    const before = rewrap(document.slice(0, span.start));
    const inside = rewrap(document.slice(span.start, span.end));
    const after = rewrap(document.slice(span.end));
    return {
      document: before + inside + after,
      expected: { start: before.length, end: before.length + inside.length },
    };
  },
};

/** Straight punctuation becomes typographic, as most publishing pipelines do. */
const smartenPunctuation: Mutation = {
  name: "smarten-punctuation",
  apply(document, span) {
    const smarten = (value: string): string =>
      value.replace(/ - /g, " — ").replace(/'/g, "’").replace(/\.\.\./g, "…");
    const before = smarten(document.slice(0, span.start));
    const inside = smarten(document.slice(span.start, span.end));
    const after = smarten(document.slice(span.end));
    if (inside === document.slice(span.start, span.end) && before === document.slice(0, span.start)) {
      return null;
    }
    return {
      document: before + inside + after,
      expected: { start: before.length, end: before.length + inside.length },
    };
  },
};

/** Break a word inside the span across a line with a hyphen, as typesetting does. */
const hyphenateLineBreak: Mutation = {
  name: "hyphenate-line-break",
  apply(document, span, random) {
    const inside = document.slice(span.start, span.end);
    const words = [...inside.matchAll(/\p{L}{6,}/gu)];
    if (words.length === 0) return null;
    const word = words[Math.floor(random() * words.length)] as RegExpMatchArray;
    const at = (word.index as number) + 3;
    const mutated = `${inside.slice(0, at)}-\n${inside.slice(at)}`;
    return {
      document: document.slice(0, span.start) + mutated + document.slice(span.end),
      expected: { start: span.start, end: span.start + mutated.length },
    };
  },
};

/** OCR-style confusions: l/1, o/0, e/c, rn/m. */
const ocrNoise: Mutation = {
  name: "ocr-noise",
  apply(document, span, random) {
    const confusions: [RegExp, string][] = [
      [/l/g, "1"],
      [/o/g, "0"],
      [/e(?=\s)/g, "c"],
      [/rn/g, "m"],
    ];
    let inside = document.slice(span.start, span.end);
    let changed = false;
    for (const [pattern, replacement] of confusions) {
      inside = inside.replace(pattern, (match) => {
        // Corrupt roughly one in eight candidates, so the quote stays
        // recognizable while no longer matching exactly.
        if (random() > 0.125) return match;
        changed = true;
        return replacement;
      });
    }
    if (!changed) return null;
    return {
      document: document.slice(0, span.start) + inside + document.slice(span.end),
      expected: { start: span.start, end: span.start + inside.length },
    };
  },
};

/** Rewrite a few words inside the span — a copy-edit, not a re-typeset. */
const copyEditInsideSpan: Mutation = {
  name: "copy-edit-inside-span",
  apply(document, span, random) {
    const substitutions: [string, string][] = [
      ["the ", "this "],
      [" is ", " was "],
      [" are ", " were "],
      ["a ", "one "],
      [" not ", " never "],
    ];
    let inside = document.slice(span.start, span.end);
    let applied = 0;
    for (const [from, to] of substitutions) {
      if (applied >= 2) break;
      const at = inside.indexOf(from, Math.floor(random() * Math.max(1, inside.length / 2)));
      if (at < 0) continue;
      inside = inside.slice(0, at) + to + inside.slice(at + from.length);
      applied++;
    }
    if (applied === 0) return null;
    return {
      document: document.slice(0, span.start) + inside + document.slice(span.end),
      expected: { start: span.start, end: span.start + inside.length },
    };
  },
};

/**
 * Delete the span outright. The only correct answer is no answer, which is
 * what separates a resolver from a nearest-neighbour search: this class is
 * where a library that always returns its best guess scores zero.
 */
const deleteSpan: Mutation = {
  name: "delete-span",
  apply(document, span) {
    return {
      document: document.slice(0, span.start) + document.slice(span.end),
      expected: null,
    };
  },
};

/** Duplicate the whole document, so every quote now occurs twice. */
const duplicateDocument: Mutation = {
  name: "duplicate-document",
  apply(document, span) {
    return {
      document: `${document}\n\n${document}`,
      expected: { start: span.start, end: span.end },
    };
  },
};

/**
 * Move the span to the end of the document. Position-based anchoring cannot
 * pass this at all; quote-based anchoring should not even notice it.
 */
const relocateSpan: Mutation = {
  name: "relocate-span",
  apply(document, span) {
    const inside = document.slice(span.start, span.end);
    const remainder = document.slice(0, span.start) + document.slice(span.end);
    const document_ = `${remainder}\n\n${inside}`;
    return {
      document: document_,
      expected: { start: remainder.length + 2, end: remainder.length + 2 + inside.length },
    };
  },
};

/**
 * Everything a publishing pipeline does at once: re-wrap, smarten punctuation,
 * hyphenate across lines, and add noise. Individually each of these is mild;
 * compounded they are where naive normalization stops being enough.
 */
const compoundRetypeset: Mutation = {
  name: "compound-retypeset",
  apply(document, span, random) {
    let current: { document: string; expected: { start: number; end: number } | null } = {
      document,
      expected: span,
    };
    for (const mutation of [reflowWhitespace, smartenPunctuation, hyphenateLineBreak, ocrNoise]) {
      if (current.expected === null) break;
      const next = mutation.apply(current.document, current.expected, random);
      if (next !== null) current = next;
    }
    if (current.document === document) return null;
    return current;
  },
};

/**
 * Rewrite about a third of the span. Past this much change the passage has
 * arguably become a different passage, so either a match or a refusal is
 * defensible — the corpus records the truth and the report shows what the
 * resolver chose, without asserting one is correct.
 */
const heavyRewrite: Mutation = {
  name: "heavy-rewrite",
  apply(document, span, random) {
    const inside = document.slice(span.start, span.end);
    const words = inside.split(/(\s+)/);
    let changed = 0;
    const rewritten = words
      .map((word) => {
        if (/^\s+$/.test(word) || word.length < 4) return word;
        if (random() > 0.33) return word;
        changed++;
        // Reverse the interior, keeping first and last letters, so length and
        // shape survive while the characters no longer align.
        return word[0] + [...word.slice(1, -1)].reverse().join("") + word[word.length - 1];
      })
      .join("");
    if (changed === 0) return null;
    return {
      document: document.slice(0, span.start) + rewritten + document.slice(span.end),
      expected: { start: span.start, end: span.start + rewritten.length },
    };
  },
};

export const MUTATIONS: readonly Mutation[] = [
  editOutsideSpan,
  reflowWhitespace,
  smartenPunctuation,
  hyphenateLineBreak,
  ocrNoise,
  copyEditInsideSpan,
  deleteSpan,
  duplicateDocument,
  relocateSpan,
  compoundRetypeset,
  heavyRewrite,
];

export interface Case {
  readonly mutation: string;
  readonly original: string;
  readonly mutated: string;
  readonly span: { start: number; end: number };
  readonly expected: { start: number; end: number } | null;
}

/**
 * Build every (document, span, mutation) case that applies. Spans are chosen
 * on sentence boundaries, which is what a person highlighting a citation
 * actually selects.
 */
export function buildCorpus(documents: readonly string[], seed = 20260827): Case[] {
  const random = seededRandom(seed);
  const cases: Case[] = [];

  for (const document of documents) {
    for (const span of sentenceSpans(document)) {
      for (const mutation of MUTATIONS) {
        const result = mutation.apply(document, span, random);
        if (result === null) continue;
        cases.push({
          mutation: mutation.name,
          original: document,
          mutated: result.document,
          span,
          expected: result.expected,
        });
      }
    }
  }
  return cases;
}

/** Sentence-ish spans of at least 40 characters, which is where quoting starts. */
export function sentenceSpans(document: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const pattern = /[^.!?\n]{40,}[.!?]/g;
  for (const match of document.matchAll(pattern)) {
    const start = (match.index as number) + (match[0].length - match[0].trimStart().length);
    spans.push({ start, end: (match.index as number) + match[0].length });
  }
  return spans;
}
