/**
 * The walkthrough model: everything about the guide that does not need a
 * browser, kept here so the route matching and the card geometry are unit
 * testable and the overlay component stays a renderer.
 */

export type TourStep = {
  id: string;
  title: string;
  body: string;
  /** `data-tour` value of the element to spotlight. A step whose element is
   *  absent still runs — the card centres and narrates — so a guide survives
   *  a page that renders a panel only when there is something to put in it. */
  target?: string;
  /** Page this step happens on, in `matchesRoute` syntax plus an optional
   *  `?query`. A guide step has none: it never leaves the page you are on. */
  route?: string;
  /** What the viewer is asked to do here. A guide narrates; it does not ask. */
  action?: string;
};

export type TourChapter = {
  id: string;
  title: string;
  /** Route pattern: `:name` matches one segment, a trailing `*` matches the rest. */
  match: string;
  steps: TourStep[];
};

function segments(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

export function matchesRoute(pattern: string, pathname: string): boolean {
  const patternParts = segments(pattern);
  const pathParts = segments(pathname);
  const wildcard = patternParts[patternParts.length - 1] === '*';
  const fixed = wildcard ? patternParts.slice(0, -1) : patternParts;

  if (wildcard ? pathParts.length < fixed.length : pathParts.length !== fixed.length) return false;

  return fixed.every((part, index) => part.startsWith(':') || part === pathParts[index]);
}

function specificity(pattern: string): number {
  const parts = segments(pattern);
  const wildcard = parts[parts.length - 1] === '*';
  const fixed = wildcard ? parts.slice(0, -1) : parts;
  const literals = fixed.filter((part) => !part.startsWith(':')).length;
  const params = fixed.length - literals;
  return literals * 100 + params * 10 + (wildcard ? 0 : 1);
}

export function chapterForPath(chapters: readonly TourChapter[], pathname: string): TourChapter | null {
  let best: TourChapter | null = null;
  let bestScore = -1;
  for (const chapter of chapters) {
    if (!matchesRoute(chapter.match, pathname)) continue;
    const score = specificity(chapter.match);
    if (score > bestScore) {
      best = chapter;
      bestScore = score;
    }
  }
  return best;
}

export type Box = { top: number; left: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Placement = { top: number; left: number; placement: 'above' | 'below' | 'center' };

/**
 * A spotlight never leaves the screen. A target taller than the viewport — the
 * workflow grid, a long run history — would otherwise draw a ring with its top
 * or bottom edge somewhere off-screen, which reads as a broken highlight
 * rather than as a highlight of something large.
 */
export function clampToViewport(box: Box, viewport: Size): Box {
  const top = Math.max(box.top, 0);
  const left = Math.max(box.left, 0);
  return {
    top,
    left,
    width: Math.min(box.left + box.width, viewport.width) - left,
    height: Math.min(box.top + box.height, viewport.height) - top,
  };
}

/** Whether the target is already on screen, so a step need not scroll at all. */
export function isFullyVisible(box: Box, viewport: Size): boolean {
  return box.top >= 0 && box.left >= 0
    && box.top + box.height <= viewport.height
    && box.left + box.width <= viewport.width;
}

const GAP = 12;
const MARGIN = 16;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Where the step card goes relative to its spotlight: below by default, above
 * when below would run off the bottom, centred when neither fits or there is
 * nothing to point at.
 */
export function cardPlacement(target: Box | null, viewport: Size, card: Size): Placement {
  if (target === null) {
    return {
      top: (viewport.height - card.height) / 2,
      left: (viewport.width - card.width) / 2,
      placement: 'center',
    };
  }

  const left = clamp(target.left, MARGIN, viewport.width - card.width - MARGIN);
  const below = target.top + target.height + GAP;
  const above = target.top - GAP - card.height;

  if (below + card.height <= viewport.height - MARGIN) return { top: below, left, placement: 'below' };
  if (above >= MARGIN) return { top: above, left, placement: 'above' };
  return {
    top: clamp((viewport.height - card.height) / 2, MARGIN, viewport.height - card.height - MARGIN),
    left,
    placement: 'center',
  };
}
