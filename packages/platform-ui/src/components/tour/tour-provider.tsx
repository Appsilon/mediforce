'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { isEditableTarget } from '@/components/command-palette/provider';
import { chapterForPath, matchesRoute, type TourStep } from '@/lib/tour';
import { GUIDE_CHAPTERS } from '@/lib/tour-content';
import { DEMO_SCENARIOS } from '@/lib/demo-content';
import { resolveDemoRoute, type DemoStep } from '@/lib/demo';
import { useDemoRun } from '@/hooks/use-demo-run';
import { TourOverlay } from './tour-overlay';

type TourState = {
  title: string;
  steps: readonly (TourStep & { route?: string; action?: string })[];
  index: number;
  /** A guide ends when you leave the page; a scenario is meant to cross pages. */
  crossesPages: boolean;
};

type TourContextValue = {
  active: TourState | null;
  start: () => void;
  startScenario: (scenarioId: string) => void;
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const [active, setActive] = React.useState<TourState | null>(null);

  const start = React.useCallback(() => {
    const chapter = chapterForPath(GUIDE_CHAPTERS, pathname);
    if (chapter === null) return;
    setActive({ title: chapter.title, steps: chapter.steps, index: 0, crossesPages: false });
  }, [pathname]);

  const startScenario = React.useCallback((scenarioId: string) => {
    const scenario = DEMO_SCENARIOS.find((entry) => entry.id === scenarioId);
    if (scenario === undefined) return;
    // Begin where the viewer already stands. Starting "run it" from a run
    // should not march them back to the workflow page to work forwards again.
    const here = scenario.steps.findIndex((entry) => {
      const pattern = entry.route?.split('?')[0];
      return pattern !== undefined && matchesRoute(pattern, pathname);
    });
    setActive({
      title: scenario.title,
      steps: scenario.steps,
      index: here === -1 ? 0 : here,
      crossesPages: true,
    });
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

  // The guide explains the page you are on, so leaving that page ends it. A
  // scenario spans pages by design, and navigating is how the viewer advances:
  // arriving at a later step's route moves to that step.
  React.useEffect(() => {
    setActive((prev) => {
      if (prev === null) return null;
      if (!prev.crossesPages) return null;
      const arrivedAt = (prev.steps as readonly DemoStep[]).findIndex(
        (step, i) => i > prev.index && step.route !== undefined && matchesRoute(step.route, pathname),
      );
      return arrivedAt === -1 ? prev : { ...prev, index: arrivedAt };
    });
  }, [pathname]);

  // A scenario takes you to the page its step happens on, so a viewer is never
  // reading a card about a screen they are not looking at. It navigates only —
  // opening the panel or the tab is still theirs to do.
  const step = active === null ? null : active.steps[active.index] ?? null;

  // Only a scenario that still has a parameter to fill pays for the lookup.
  const needsRun =
    active?.crossesPages === true
    && active.steps.some((entry) => entry.route?.includes(':name') === true || entry.route?.includes(':runId') === true);
  const demoRun = useDemoRun(pathname.split('/')[1] ?? '', needsRun === true);

  const wantedRoute =
    active?.crossesPages === true && step?.route !== undefined
      ? resolveDemoRoute(step.route, pathname, demoRun)
      : null;

  // Compared with the query included: a tab is `?tab=`, so ignoring the query
  // made every step that only changes a tab look like it had already arrived.
  const query = searchParams?.toString() ?? '';
  const currentUrl = query === '' ? pathname : `${pathname}?${query}`;

  // The viewer has walked ahead of the narration — they are standing on a page
  // a *later* step covers. Arrival is about to move the step on, so pushing
  // them back to this step's page would bounce them. Only a later step counts:
  // treating the current step's own page as "ahead" is what stopped the
  // scenario ever advancing from the workflow page to the run.
  const stepPattern = step?.route?.split('?')[0];
  // Consecutive steps share a page and differ only by tab, so "somewhere a
  // later step covers" is not enough — it describes the current step's page
  // too, and suppressing there is what stopped the scenario ever moving.
  const onThisStepsPage = stepPattern !== undefined && matchesRoute(stepPattern, pathname);
  const walkedAhead =
    active !== null
    && active.crossesPages
    && !onThisStepsPage
    && active.steps.some((entry, entryIndex) => {
      if (entryIndex <= active.index) return false;
      const pattern = entry.route?.split('?')[0];
      return pattern !== undefined && matchesRoute(pattern, pathname);
    });

  React.useEffect(() => {
    if (wantedRoute === null || wantedRoute === currentUrl) return;
    if (walkedAhead) return;
    router.push(wantedRoute);
  }, [wantedRoute, currentUrl, walkedAhead, router]);

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
    () => ({ active, start, startScenario, stop, next, back }),
    [active, start, startScenario, stop, next, back],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {active !== null && step !== null && (
        <TourOverlay
          title={active.title}
          step={step}
          action={(step as DemoStep).action}
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
