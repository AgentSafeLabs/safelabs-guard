// Pure decisions for bringing the result card into view after a turn. The DOM
// reads (rect, viewport, media queries) are done by the caller and passed in,
// so the rules are unit-tested without a browser.

export interface ScrollInput {
  /** True when the layout is the single-column (mobile) one. */
  stacked: boolean;
  reducedMotion: boolean;
  /** The result card's bounding rect, relative to the viewport. */
  rect: { top: number; bottom: number; height: number };
  viewportHeight: number;
}

export interface ScrollPlan {
  scroll: boolean;
  /** "auto" is instant scrolling. */
  behavior: "smooth" | "auto";
}

/**
 * Stacked layout: always scroll. Side-by-side layout: only when the card is
 * not fully visible (for a card taller than the viewport, when its top is not
 * on screen). Reduced motion turns smooth scrolling into an instant jump.
 */
export function planResultScroll({ stacked, reducedMotion, rect, viewportHeight }: ScrollInput): ScrollPlan {
  const behavior = reducedMotion ? "auto" : "smooth";
  if (stacked) return { scroll: true, behavior };
  const fits = rect.height <= viewportHeight;
  const hidden = fits ? rect.top < 0 || rect.bottom > viewportHeight : rect.top < 0 || rect.top >= viewportHeight;
  return { scroll: hidden, behavior };
}

/** Elements where the person may be typing; focus is never moved off them. */
export function isTypingTarget(el: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * A finished turn may move the page and focus only when a turn has actually
 * ended (so never on first render or Restart run) and the person is not
 * recording.
 */
export function shouldRevealResult(opts: { finishedTurns: number; recording: boolean }): boolean {
  return opts.finishedTurns > 0 && !opts.recording;
}
