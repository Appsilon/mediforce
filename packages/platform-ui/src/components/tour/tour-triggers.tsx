'use client';

import { Compass } from 'lucide-react';
import { useTour } from './tour-provider';

/** Walks you through whatever page you are on. */
export function GuideTrigger() {
  const { start } = useTour();
  return (
    <button
      type="button"
      onClick={start}
      className="inline-flex h-8 items-center gap-2 rounded-md border bg-muted/40 px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      aria-label="Guide me through this page"
      data-testid="guide-trigger"
    >
      <Compass className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Guide</span>
    </button>
  );
}
