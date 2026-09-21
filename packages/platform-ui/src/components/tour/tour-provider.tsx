'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { isEditableTarget } from '@/components/command-palette/provider';
import { chapterForPath, type TourStep } from '@/lib/tour';
import { GUIDE_CHAPTERS } from '@/lib/tour-content';
import { TourOverlay } from './tour-overlay';

type TourState = { title: string; steps: readonly TourStep[]; index: number };

type TourContextValue = {
  active: TourState | null;
  start: () => void;
  stop: () => void;
  next: () => void;
  back: () => void;
};

const Ctx = React.createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = React.useContext(Ctx);
  if (ctx === null) throw new Error('useTour must be used within <TourProvider>');
  return ctx;
}

/**
 * The guide is deliberately non-modal, so a dialog, palette or popover can be
 * open on top of it — and Escape belongs to whichever of those the user opened
 * last, not to the guide underneath it.
 */
function isTopmostOverlay(): boolean {
  const overlays = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
  return [...overlays].every((overlay) => overlay.getAttribute('data-testid') === 'tour-card');
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const [active, setActive] = React.useState<TourState | null>(null);

  const start = React.useCallback(() => {
    const chapter = chapterForPath(GUIDE_CHAPTERS, pathname);
    if (chapter === null) return;
    setActive({ title: chapter.title, steps: chapter.steps, index: 0 });
  }, [pathname]);

  const stop = React.useCallback(() => setActive(null), []);

  const next = React.useCallback(() => {
    setActive((prev) => {
      if (prev === null) return null;
      if (prev.index >= prev.steps.length - 1) return null;
      return { ...prev, index: prev.index + 1 };
    });
  }, []);

  const back = React.useCallback(() => {
    setActive((prev) => (prev === null ? null : { ...prev, index: Math.max(0, prev.index - 1) }));
  }, []);

  // The guide explains the page you are on, so leaving that page ends it.
  React.useEffect(() => setActive(null), [pathname]);

  const running = active !== null;

  React.useEffect(() => {
    if (!running) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        if (isTopmostOverlay()) stop();
        return;
      }
      // The guide sits over a live page, so an arrow key moving a caret must
      // not also move the guide.
      if (isEditableTarget(event.target)) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        next();
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        back();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, stop, next, back]);

  const value = React.useMemo<TourContextValue>(
    () => ({ active, start, stop, next, back }),
    [active, start, stop, next, back],
  );

  const step = active === null ? null : active.steps[active.index] ?? null;

  return (
    <Ctx.Provider value={value}>
      {children}
      {active !== null && step !== null && (
        <TourOverlay
          title={active.title}
          step={step}
          index={active.index}
          total={active.steps.length}
          onNext={next}
          onBack={back}
          onClose={stop}
        />
      )}
    </Ctx.Provider>
  );
}
