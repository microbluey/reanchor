/// <reference lib="dom" />

/**
 * DOM adapter — resolve a selector to a live `Range`.
 *
 * The core of this library takes a string and returns offsets, deliberately:
 * that is what makes it portable and dependency-free. But an annotation tool
 * holds a DOM, not a string, and wants a `Range` it can highlight. The work in
 * between — flattening text nodes into one stream, and mapping an offset in
 * that stream back to a node and a position inside it — is mechanical, and
 * every caller writing it themselves is a caller who will not adopt anything.
 *
 * The four-function surface (`fromRange`, `toRange`, `fromTextPosition`,
 * `toTextPosition`) matches `dom-anchor-text-quote`, so migrating from it is a
 * changed import rather than changed code. `describeRange`, `resolveRange`, and
 * `resolveRanges` are the same operations with this library's own return
 * shapes, which carry the rung and the confidence — the information you need to
 * decide whether to show a highlight at all.
 *
 * This module is the only one that touches the DOM, and it is a separate entry
 * point (`reanchor/dom`) so that importing `reanchor` still pulls in neither
 * DOM types nor DOM assumptions.
 */

import { describeQuote, type DescribeOptions } from "./describe.js";
import {
  prepareDocument,
  resolveQuote,
  type ResolvedQuote,
  type ResolveOptions,
  type TextQuoteSelector,
} from "./resolve.js";

/** A span of the flattened text stream, in characters. */
export interface TextPositionSelector {
  readonly start: number;
  readonly end: number;
}

export interface DomOptions {
  /**
   * Which text nodes contribute to the text stream. The default includes every
   * one, so that offsets agree character for character with
   * `root.textContent` — which is what makes positions recorded by other
   * libraries, and by earlier versions of your own code, still valid.
   *
   * Pass a predicate to exclude nodes that are text to the DOM but not to a
   * reader:
   *
   * ```ts
   * const include = (node: Text) =>
   *   !node.parentElement?.closest("script, style, noscript");
   * ```
   *
   * A selector recorded under one predicate must be resolved under the same
   * one; they describe different documents otherwise.
   */
  include?: (node: Text) => boolean;
}

export interface DomResolveOptions extends ResolveOptions, DomOptions {
  /**
   * Accepted for source compatibility with `dom-anchor-text-quote` and
   * ignored. That library searches outward from a position hint, so a hint
   * changes which of several copies of a passage it finds. This one ranks
   * copies by how well the recorded context agrees with each, and reports the
   * others as rivals; proximity would be a second signal, but it would have to
   * earn its place against the benchmark before being wired in, not be
   * accepted silently because the parameter happened to be passed.
   */
  hint?: number;
}

export interface DomResolvedQuote extends ResolvedQuote {
  /** The resolved span as a live range, ready to surround or highlight. */
  readonly range: Range;
}

/**
 * A root's text nodes flattened into one string, with the offset each node
 * begins at. Resolving many selectors against one root should build this once
 * — walking the DOM is usually the expensive half.
 */
export interface DomTextMap {
  readonly root: Node;
  /** The concatenated text of every included text node, in document order. */
  readonly text: string;
  readonly nodes: readonly Text[];
  /** `starts[i]` is the offset in `text` where `nodes[i]` begins. */
  readonly starts: readonly number[];
}

/** Flatten `root`'s text nodes into a stream, remembering where each begins. */
export function mapTextNodes(root: Node, options: DomOptions = {}): DomTextMap {
  const include = options.include;
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";

  const push = (node: Text): void => {
    if (node.data.length === 0) return;
    if (include !== undefined && !include(node)) return;
    nodes.push(node);
    starts.push(text.length);
    text += node.data;
  };

  if (isText(root)) {
    // A TreeWalker never yields its own root, so a text-node root would
    // otherwise flatten to nothing.
    push(root);
  } else {
    const walker = ownerDocument(root).createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      push(node as Text);
    }
  }

  return { root, text, nodes, starts };
}

/** Record a selector for `range`, with enough context to identify it again. */
export function describeRange(
  target: Node | DomTextMap,
  range: Range,
  options: DescribeOptions & DomOptions = {},
): TextQuoteSelector {
  const map = asTextMap(target, options);
  const a = offsetOfPoint(map, range.startContainer, range.startOffset);
  const b = offsetOfPoint(map, range.endContainer, range.endOffset);
  return describeQuote(map.text, Math.min(a, b), Math.max(a, b), options);
}

/**
 * Locate `selector` under `target` and return it as a range, or `null` if it
 * cannot be found with enough confidence.
 */
export function resolveRange(
  target: Node | DomTextMap,
  selector: TextQuoteSelector,
  options: DomResolveOptions = {},
): DomResolvedQuote | null {
  const map = asTextMap(target, options);
  const resolved = resolveQuote(map.text, selector, options);
  return resolved === null ? null : { ...resolved, range: rangeFor(map, resolved.start, resolved.end) };
}

/**
 * Resolve many selectors against one root. Equivalent to `resolveRange` per
 * selector, but walks the DOM and normalizes the text once.
 */
export function resolveRanges(
  root: Node,
  selectors: readonly TextQuoteSelector[],
  options: DomResolveOptions = {},
): (DomResolvedQuote | null)[] {
  const map = mapTextNodes(root, options);
  const prepared = prepareDocument(map.text, options.normalize ?? {});
  return selectors.map((selector) => {
    const resolved = resolveQuote(prepared, selector, options);
    return resolved === null
      ? null
      : { ...resolved, range: rangeFor(map, resolved.start, resolved.end) };
  });
}

/**
 * Record a selector for `range`.
 *
 * Source-compatible with `dom-anchor-text-quote`'s function of the same name.
 * It differs in one respect, and the difference is the point: that library
 * records 32 characters of context either side unconditionally, while this one
 * grows context until the quote is unique in the document, which is what lets
 * repeated passages be told apart later.
 */
export function fromRange(
  root: Node,
  range: Range,
  options: DescribeOptions & DomOptions = {},
): TextQuoteSelector {
  return describeRange(root, range, options);
}

/**
 * Locate `selector` under `root` as a range, or `null`.
 *
 * Source-compatible with `dom-anchor-text-quote`'s function of the same name.
 * Use `resolveRange` instead where you can: a range on its own cannot tell you
 * whether it was found character for character or reconstructed from an edited
 * passage, and a caller that shows both identically is a caller that shows
 * wrong citations as verified.
 */
export function toRange(
  root: Node,
  selector: TextQuoteSelector,
  options: DomResolveOptions = {},
): Range | null {
  return resolveRange(root, selector, options)?.range ?? null;
}

/** Record a selector for the text stream span `selector`. */
export function fromTextPosition(
  root: Node,
  selector: TextPositionSelector,
  options: DescribeOptions & DomOptions = {},
): TextQuoteSelector {
  const map = asTextMap(root, options);
  return describeQuote(map.text, selector.start, selector.end, options);
}

/** Locate `selector` under `root` as a text stream span, or `null`. */
export function toTextPosition(
  root: Node,
  selector: TextQuoteSelector,
  options: DomResolveOptions = {},
): TextPositionSelector | null {
  const map = asTextMap(root, options);
  const resolved = resolveQuote(map.text, selector, options);
  return resolved === null ? null : { start: resolved.start, end: resolved.end };
}

function asTextMap(target: Node | DomTextMap, options: DomOptions): DomTextMap {
  return isTextMap(target) ? target : mapTextNodes(target, options);
}

function isTextMap(target: Node | DomTextMap): target is DomTextMap {
  const candidate = target as DomTextMap;
  return Array.isArray(candidate.starts) && Array.isArray(candidate.nodes);
}

function isText(node: Node): node is Text {
  return node.nodeType === 3;
}

function ownerDocument(node: Node): Document {
  return node.ownerDocument ?? (node as Document);
}

function rangeFor(map: DomTextMap, start: number, end: number): Range {
  const range = ownerDocument(map.root).createRange();
  // A collapsed span sits at one boundary, so both ends must resolve it the
  // same way or they land in different nodes and the range inverts.
  const from = pointAt(map, start, "start");
  const to = pointAt(map, end, start === end ? "start" : "end");
  if (from === null || to === null) {
    range.setStart(map.root, 0);
    range.collapse(true);
    return range;
  }
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

interface DomPoint {
  node: Text;
  offset: number;
}

/**
 * The node and in-node offset for a stream offset.
 *
 * An offset on a node boundary belongs to two nodes at once — it is the end of
 * one and the start of the next — so which one is correct depends on which end
 * of a range is asking. A range's start belongs inside the node holding the
 * first character; its end belongs at the tail of the node holding the last.
 * Choosing wrongly produces a range that renders one node too wide.
 */
function pointAt(map: DomTextMap, offset: number, bias: "start" | "end"): DomPoint | null {
  if (map.nodes.length === 0) return null;
  const clamped = Math.max(0, Math.min(offset, map.text.length));
  const index = Math.max(0, lastStartBefore(map.starts, clamped, bias === "end"));
  const node = map.nodes[index] as Text;
  const local = clamped - (map.starts[index] as number);
  return { node, offset: Math.max(0, Math.min(local, node.data.length)) };
}

/**
 * Index of the last node starting at or before `offset` — strictly before it
 * when `strict`. Returns -1 when no node qualifies, which happens only for
 * `offset` 0 under `strict`.
 */
function lastStartBefore(starts: readonly number[], offset: number, strict: boolean): number {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const start = starts[mid] as number;
    if (strict ? start < offset : start <= offset) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

/**
 * The stream offset of a DOM point.
 *
 * A range endpoint need not be in a text node: selecting a whole paragraph
 * gives an element container with a child index, and browsers produce such
 * points routinely. Both forms have to map onto the stream, or a selector
 * recorded from a real selection lands somewhere else.
 */
function offsetOfPoint(map: DomTextMap, container: Node, offset: number): number {
  if (isText(container)) {
    const index = map.nodes.indexOf(container);
    if (index !== -1) {
      return (map.starts[index] as number) + Math.max(0, Math.min(offset, container.data.length));
    }
    // Excluded by `include`, or outside `root` altogether.
    return offsetAtOrAfter(map, container);
  }

  const child = container.childNodes[offset];
  if (child !== undefined) return offsetAtOrAfter(map, child);

  // `offset` is the child count: the point is past everything inside
  // `container`, so it sits at the tail of the last text it holds.
  for (let index = map.nodes.length - 1; index >= 0; index--) {
    const node = map.nodes[index] as Text;
    if (container.contains(node)) return (map.starts[index] as number) + node.data.length;
  }
  return offsetAtOrAfter(map, container);
}

/** Where the first mapped text at or after `node` begins; the end otherwise. */
function offsetAtOrAfter(map: DomTextMap, node: Node): number {
  const wanted = Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY;
  for (let index = 0; index < map.nodes.length; index++) {
    const candidate = map.nodes[index] as Text;
    if (candidate === node || (node.compareDocumentPosition(candidate) & wanted) !== 0) {
      return map.starts[index] as number;
    }
  }
  return map.text.length;
}
