// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  describeRange,
  fromRange,
  fromTextPosition,
  mapTextNodes,
  resolveRange,
  resolveRanges,
  toRange,
  toTextPosition,
} from "../src/dom.js";

/** Build a detached root from HTML, so tests never depend on document order. */
function root(html: string): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element;
}

/** A range over the flattened text, by offset, for setting up cases. */
function rangeAt(node: HTMLElement, start: number, end: number): Range {
  const map = mapTextNodes(node);
  const range = document.createRange();
  const locate = (offset: number): [Text, number] => {
    for (let i = map.nodes.length - 1; i >= 0; i--) {
      const at = map.starts[i]!;
      if (offset >= at) return [map.nodes[i]!, offset - at];
    }
    throw new Error(`offset ${offset} is outside the text`);
  };
  const [startNode, startOffset] = locate(start);
  const [endNode, endOffset] = locate(end);
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

describe("mapTextNodes", () => {
  it("flattens text nodes in document order, agreeing with textContent", () => {
    const node = root("<p>Alpha <em>beta</em> gamma</p><p>delta</p>");
    const map = mapTextNodes(node);
    expect(map.text).toBe(node.textContent);
    expect(map.nodes.map((n) => n.data)).toEqual(["Alpha ", "beta", " gamma", "delta"]);
    expect(map.starts).toEqual([0, 6, 10, 16]);
  });

  it("flattens a text node passed as the root", () => {
    const text = document.createTextNode("just text");
    expect(mapTextNodes(text).text).toBe("just text");
  });

  it("skips empty text nodes, which contribute no offsets", () => {
    const node = root("<p></p><p>content</p>");
    node.firstElementChild?.appendChild(document.createTextNode(""));
    expect(mapTextNodes(node).nodes).toHaveLength(1);
  });

  it("honours an include predicate, which then defines the document", () => {
    const node = root("<p>visible</p><script>hidden()</script>");
    const include = (text: Text) => text.parentElement?.tagName !== "SCRIPT";
    expect(mapTextNodes(node, { include }).text).toBe("visible");
    expect(mapTextNodes(node).text).toBe("visiblehidden()");
  });
});

describe("resolveRange", () => {
  it("returns a range over the quote, spanning element boundaries", () => {
    const node = root("<p>The result <em>held</em> at that concentration.</p>");
    const resolved = resolveRange(node, { exact: "result held at" });
    expect(resolved).not.toBeNull();
    expect(resolved?.range.toString()).toBe("result held at");
    expect(resolved?.method).toBe("exact");
  });

  it("ends a range inside the node holding the last character, not the next one", () => {
    const node = root("<p><em>quoted</em>tail</p>");
    const resolved = resolveRange(node, { exact: "quoted" });
    const range = resolved?.range as Range;
    expect(range.endContainer.nodeValue).toBe("quoted");
    expect(range.endOffset).toBe(6);
    expect(range.toString()).toBe("quoted");
  });

  it("returns a range that can be surrounded, which needs one common container", () => {
    // An offset on a node boundary is both the end of one node and the start of
    // the next. Ending at the head of the next node stringifies identically but
    // lifts the range's common ancestor to the parent element, and
    // `surroundContents` then throws — so highlighting, the reason most callers
    // want a range at all, fails on any quote that ends at a boundary.
    const node = root("<p>Alpha <em>beta gamma</em> delta.</p>");
    const range = resolveRange(node, { exact: "beta gamma" })?.range as Range;
    range.surroundContents(document.createElement("mark"));
    expect(node.innerHTML).toBe("<p>Alpha <em><mark>beta gamma</mark></em> delta.</p>");
  });

  it("carries the rung and confidence, so a caller can decline to highlight", () => {
    const node = root("<p>The measurement was repeated at this concentration.</p>");
    const resolved = resolveRange(node, {
      exact: "The measurement was repeated at the concentration.",
    });
    expect(resolved?.method).toBe("approximate");
    expect(resolved?.confidence).toBeLessThan(1);
    expect(resolved?.range.toString()).toBe("The measurement was repeated at this concentration.");
  });

  it("returns null rather than a least-bad range when the passage is gone", () => {
    const node = root("<p>Entirely unrelated prose about something else.</p>");
    expect(resolveRange(node, { exact: "the measurement was repeated at length" })).toBeNull();
  });

  it("resolves a quote broken by a hyphenated line break in the markup", () => {
    const node = root("<p>The measure-\nment was repeated.</p>");
    const resolved = resolveRange(node, { exact: "The measurement was repeated." });
    expect(resolved).not.toBeNull();
    expect(resolved?.range.toString()).toBe("The measure-\nment was repeated.");
  });

  it("accepts a prebuilt text map, walking the DOM once", () => {
    const node = root("<p>Alpha beta gamma delta.</p>");
    const map = mapTextNodes(node);
    expect(resolveRange(map, { exact: "beta gamma" })?.range.toString()).toBe("beta gamma");
  });
});

describe("describeRange", () => {
  it("round-trips a range selected across elements", () => {
    const node = root("<p>Alpha <em>beta gamma</em> delta epsilon.</p>");
    const original = rangeAt(node, 6, 16);
    expect(original.toString()).toBe("beta gamma");

    const selector = describeRange(node, original);
    expect(selector.exact).toBe("beta gamma");
    expect(resolveRange(node, selector)?.range.toString()).toBe("beta gamma");
  });

  it("records context even for a quote that is unique today", () => {
    const node = root("<p>A distinctive sentence appears exactly once here.</p>");
    const selector = describeRange(node, rangeAt(node, 2, 24));
    expect(selector.exact).toBe("distinctive sentence a");
    expect(selector.suffix).not.toBe("");
  });

  it("takes a range endpoint given as an element and a child index", () => {
    const node = root("<p>first</p><p>second</p>");
    const range = document.createRange();
    range.setStart(node, 1);
    range.setEnd(node, 2);
    expect(range.toString()).toBe("second");
    expect(describeRange(node, range).exact).toBe("second");
  });

  it("takes an endpoint at an element's child count, meaning past its content", () => {
    const paragraph = root("<p>alpha beta</p>").firstElementChild as HTMLElement;
    const range = document.createRange();
    range.setStart(paragraph.firstChild as Text, 6);
    range.setEnd(paragraph, paragraph.childNodes.length);
    expect(describeRange(paragraph, range).exact).toBe("beta");
  });

  it("normalizes an inverted range rather than throwing", () => {
    const node = root("<p>alpha beta gamma</p>");
    const text = node.firstChild?.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 6);
    // setEnd before start would collapse it; build the inversion by hand.
    Object.defineProperty(range, "startOffset", { value: 10, configurable: true });
    Object.defineProperty(range, "endOffset", { value: 6, configurable: true });
    expect(describeRange(node, range).exact).toBe("beta");
  });
});

describe("resolveRanges", () => {
  it("resolves many selectors against one root, keeping order and misses", () => {
    const node = root("<p>Alpha beta. Gamma delta. Epsilon zeta.</p>");
    const results = resolveRanges(node, [
      { exact: "Gamma delta" },
      { exact: "not present at all in this document" },
      { exact: "Epsilon zeta" },
    ]);
    expect(results.map((r) => r?.range.toString() ?? null)).toEqual([
      "Gamma delta",
      null,
      "Epsilon zeta",
    ]);
  });
});

describe("the dom-anchor-text-quote surface", () => {
  it("round-trips fromRange through toRange", () => {
    const node = root("<p>Alpha <em>beta gamma</em> delta.</p>");
    const selector = fromRange(node, rangeAt(node, 6, 16));
    expect(toRange(node, selector)?.toString()).toBe("beta gamma");
  });

  it("round-trips fromTextPosition through toTextPosition", () => {
    const node = root("<p>Alpha beta gamma delta epsilon.</p>");
    const selector = fromTextPosition(node, { start: 6, end: 16 });
    expect(selector.exact).toBe("beta gamma");
    expect(toTextPosition(node, selector)).toEqual({ start: 6, end: 16 });
  });

  it("returns null from toRange where the incumbent returns null", () => {
    const node = root("<p>Alpha beta gamma.</p>");
    expect(toRange(node, { exact: "an entirely different sentence about elk" })).toBeNull();
  });

  it("ignores a position hint rather than acting on it silently", () => {
    const node = root("<p>sat on the mat. Then it sat on the rug.</p>");
    const selector = { exact: "sat on the", prefix: "Then it ", suffix: " rug" };
    const withHint = toTextPosition(node, selector, { hint: 0 });
    expect(withHint).toEqual(toTextPosition(node, selector));
    expect(node.textContent?.slice(withHint?.start, withHint?.end)).toBe("sat on the");
    expect(withHint?.start).toBe(24);
  });
});

describe("the case this library exists for, through the DOM", () => {
  let node: HTMLElement;
  const original = "The measurement was repeated at the same concentration and held.";
  const revised = "The measurement was repeated at this same concentration and held.";

  beforeEach(() => {
    // A passage revised in place, while a verbatim copy of the old wording
    // survives further down — so the only exact match is the stale copy.
    node = root(
      `<h2>Methods</h2><p>${revised}</p><h2>Errata</h2><p>Previously reported: ${original}</p>`,
    );
  });

  it("prefers the revised passage over the stale verbatim copy", () => {
    const capture = root(`<h2>Methods</h2><p>${original}</p><h2>Errata</h2>`);
    const at = capture.textContent?.indexOf(original) as number;
    const selector = fromTextPosition(capture, { start: at, end: at + original.length });

    const resolved = resolveRange(node, selector);
    expect(resolved?.range.toString()).toBe(revised);
    expect(node.textContent?.slice(resolved?.start, resolved?.end)).toBe(revised);
    expect(resolved?.start).toBe(node.textContent?.indexOf(revised));
  });
});
