/**
 * Types for `dom-anchor-text-quote`, which ships none.
 *
 * Several of its downstream users each hand-write a file like this one; that
 * duplication is part of why this comparison exists. Only the two functions the
 * comparison calls are declared, and the root is typed as what they actually
 * touch — `textContent` — rather than as a `Node`, so the comparison needs no
 * DOM. `fromRange` and `toRange` do need one and are not declared here.
 */
declare module "dom-anchor-text-quote" {
  interface TextRoot {
    readonly textContent: string;
  }

  interface QuoteSelector {
    readonly exact: string;
    readonly prefix?: string;
    readonly suffix?: string;
  }

  interface PositionSelector {
    readonly start: number;
    readonly end: number;
  }

  export function fromTextPosition(root: TextRoot, selector: PositionSelector): QuoteSelector;

  export function toTextPosition(
    root: TextRoot,
    selector: QuoteSelector,
    options?: { hint?: number },
  ): PositionSelector | null;
}
