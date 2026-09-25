'use client';

import { Compass, X } from 'lucide-react';
import { useTour } from './tour-provider';

/**
 * The folded-away walkthrough. It lives in the top bar rather than floating
 * over the page, so folding it leaves the screen completely clear — which is
 * the point of folding it.
 */
export function TourPill() {
  const { active, stop, expand } = useTour();
  if (active === null || !active.collapsed) return null;

  return (
    <div className="flex h-8 items-center gap-1 rounded-md border bg-muted/40 pl-2 pr-0.5 text-xs">
      <button
        type="button"
        onClick={expand}
        className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
        data-testid="tour-resume"
      >
        <Compass className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span className="hidden max-w-[10rem] truncate font-medium text-foreground sm:inline">
          {active.title}
        </span>
        <span className="tabular-nums">
          {active.index + 1} of {active.steps.length}
        </span>
      </button>
      <button
        type="button"
        onClick={stop}
        aria-label="End walkthrough"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
