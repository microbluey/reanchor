/**
 * Documents for the benchmark corpus.
 *
 * Written for this repository rather than scraped, so the corpus can be
 * redistributed under the same licence as the code. They deliberately differ
 * in shape: prose with long sentences, a technical text dense with punctuation
 * and identifiers, a legal-style text with numbered clauses and repeated
 * boilerplate, and a CJK text where whitespace carries no word boundaries.
 */

const PROSE = `
On the persistence of marginalia

A reader's marks are older than the printed book, and for most of that history
they lived on the same physical surface as the words they answered. Ink on the
page could not drift, because there was nowhere for it to drift to. The mark
and the mark's subject were one object, and the question of how to find the
passage again simply did not arise.

Digital annotation broke that unity for a good reason. Separating the mark from
the document lets many readers annotate one text without each holding a copy of
it, and lets one reader carry their marks between devices. But the separation
introduces a reference, and every reference can dangle. The annotation now
points at the document from outside, and the document is free to move.

What it means for an annotation to survive is therefore not obvious. A
character offset survives nothing: insert a sentence at the top and every later
offset is wrong, though nothing the reader cared about has changed. A paragraph
number survives reformatting but not editing. A quotation survives editing but
not paraphrase, and cannot by itself distinguish two identical sentences in one
document.

There is no selector that survives everything, because at some point the
passage the reader marked stops existing in any meaningful sense. The
interesting question is not how to always succeed but how to know which case
you are in. A system that reports where it thinks the mark belongs, together
with how sure it is, can be built on. A system that always returns its best
guess with no way to tell a certainty from a coincidence cannot.
`.trim();

const TECHNICAL = `
Implementation notes: offset mapping

The normalize() function returns three parallel arrays: text, srcStart, and
srcEnd. Indices into text are UTF-16 code unit indices, matching JavaScript's
own string indexing, and srcStart[i] gives the source offset that produced
text[i]. This is not always a bijection. Consider the following cases.

Case 1: expansion. The ellipsis U+2026 folds to three ASCII full stops, so one
source code point produces three normalized characters. All three map back to
the same one-character source range [i, i+1).

Case 2: contraction. A run of whitespace collapses to one space. That space maps
back to the whole run, so toSourceSpan() returns a range wider than one
character. Callers that assume span.end - span.start equals the normalized
length will be wrong here, which is why the API returns explicit ranges rather
than a single offset per character.

Case 3: deletion. U+00AD SOFT HYPHEN and the zero-width family produce no
normalized characters at all and appear nowhere in the maps. A span that begins
immediately after a soft hyphen therefore starts at the following visible
character, which is the desired behaviour: the soft hyphen is not part of any
quote a reader would recognize.

Case 4: reordering. There is none. Every transformation here is order-preserving,
so srcStart and srcEnd are monotonically non-decreasing, and a binary search
over them is valid. The test suite asserts this invariant directly rather than
trusting the argument, because a future transformation could break it silently.

The alignment in search.ts is Sellers' variant of Levenshtein distance with free
end gaps on the haystack side. The cost row is initialized to zero rather than
to j, which lets an alignment begin at any haystack position at no cost, and the
origin row propagates the start of the best alignment reaching each cell. Peak
memory is O(window) rather than O(needle * window), since no traceback matrix is
retained.
`.trim();

const LEGAL = `
Schedule 3 — Anchoring obligations

3.1 The Provider shall record, for each Annotation, a Selector sufficient to
identify the annotated passage. The Selector shall include the exact text of the
passage and such context as is necessary to distinguish that passage from any
other identical passage in the same Document.

3.2 The Provider shall not rely solely upon a character offset. The Parties
acknowledge that a character offset is not stable across reformatting of the
Document, and that reliance upon such an offset would cause the Annotation to
refer to a passage other than the passage annotated.

3.3 Where the Provider is unable to identify the annotated passage with
reasonable confidence, the Provider shall record the Annotation as unresolved
and shall not display it against any passage. The Parties acknowledge that
displaying an Annotation against the wrong passage is more harmful than
displaying no Annotation, because the former misrepresents the Document.

3.4 The Provider shall record, for each resolution, the method by which the
passage was identified and the confidence attaching to that identification. The
Customer may configure a minimum confidence below which Annotations shall be
treated as unresolved under clause 3.3.

3.5 Nothing in this Schedule requires the Provider to identify a passage which
has been removed from the Document. Where a passage has been removed, the
Provider shall record the Annotation as unresolved under clause 3.3.
`.trim();

const CJK = `
锚定的稳定性

标注与被标注的文本一旦分离，就产生了引用，而引用随时可能失效。字符偏移量是最
脆弱的一种引用：在文档开头插入一句话，后面所有偏移量都会错位，尽管读者关心的
内容一个字都没有变。段落编号能扛住重新排版，却扛不住编辑。引用原文能扛住编辑，
却扛不住改写，也无法区分同一篇文档里两句完全相同的话。

不存在能扛住一切的选择器，因为某个时刻之后，读者当初标注的那段文字在任何有意
义的层面上都已经不存在了。真正要紧的问题不是如何永远成功，而是如何知道自己身
处哪一种情形。一个会报告置信度的系统可以在其之上继续构建；一个永远返回最佳猜
测、却无法区分确定与巧合的系统则不能。

中文没有词间空格，这让归一化的处理不同于英文。全角标点需要折叠到半角，全角字
母需要折叠到半角字母，但字与字之间不应插入任何空白。软连字符和零宽字符同样要
被丢弃，因为它们不属于任何读者会认出来的引文。
`.trim();

export const DOCUMENTS: readonly string[] = [PROSE, TECHNICAL, LEGAL, CJK];
