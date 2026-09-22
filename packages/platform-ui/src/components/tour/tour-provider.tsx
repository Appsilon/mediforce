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
  /** Folded into a pill so the viewer can work, or show someone the screen. */
  collapsed: boolean;
};

type TourContextValue = {
  active: TourState | null;
  start: () => void;
  startScenario: (scenarioId: string) => void;
  stop: () => void;
  next: () => void;
  back: () => void;
  collapse: () => void;
  expand: () => void;
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
    setActive({
      title: chapter.title,
      steps: chapter.steps,
      index: 0,
      crossesPages: false,
      collapsed: false,
    });
  }, [pathname]);

  const startScenario = React.useCallback((scenarioId: string) => {
    const scenario = DEMO_SCENARIOS.find((entry) => entry.id === scenarioId);
    if (scenario === undefined) return;
    // Starting "run it" from a run should not march the viewer back to the
    // workflow page to work forwards again.
    const here = scenario.steps.findIndex((entry) => {
      const pattern = entry.route?.split('?')[0];
      return pattern !== undefined && matchesRoute(pattern, pathname);
    });
    setActive({
      title: scenario.title,
      steps: scenario.steps,
      index: here === -1 ? 0 : here,
      crossesPages: true,
      collapsed: false,
    });
  }, [pathname]);

  const stop = React.useCallback(() => setActive(null), []);

  const collapse = React.useCallback(
    () => setActive((prev) => (prev === null ? null : { ...prev, collapsed: true })),
    [],
  );
  const expand = React.useCallback(
    () => setActive((prev) => (prev === null ? null : { ...prev, collapsed: false })),
    [],
  );

  const next = React.useCallback(() => {
    setActive((prev) => {
      if (prev === null) return null;
      if (prev.index >= prev.steps.length - 1) return null;
      return { ...prev, index: prev.index + 1, collapsed: false };
    });
  }, []);

  const back = React.useCallback(() => {
    setActive((prev) =>
      prev === null ? null : { ...prev, index: Math.max(0, prev.index - 1), collapsed: false },
    );
  }, []);

  // A guide is about the page you are on, so leaving ends it. A scenario spans
  // pages, and arriving at a later step's route is how the viewer advances.
  React.useEffect(() => {
    setActive((prev) => {
      if (prev === null) return null;
      if (!prev.crossesPages) return null;
      const arrivedAt = (prev.steps as readonly DemoStep[]).findIndex(
        (step, i) => i > prev.index && step.route !== undefined && matchesRoute(step.route, pathname),
      );
      return arrivedAt === -1 ? prev : { ...prev, index: arrivedAt, collapsed: false };
    });
  }, [pathname]);

  const step = active === null ? null : active.steps[active.index] ?? null;

  const needsRun =
    active?.crossesPages === true
    && active.steps.some((entry) => entry.route?.includes(':name') === true || entry.route?.includes(':runId') === true);
  const demoRun = useDemoRun(pathname.split('/')[1] ?? '', needsRun === true);

  const wantedRoute =
    active?.crossesPages === true && step?.route !== undefined
      ? resolveDemoRoute(step.route, pathname, demoRun)
      : null;

  // The query is part of the comparison because a tab is `?tab=`; without it
  // every step that only switches tab looks like it has already arrived.
  const query = searchParams?.toString() ?? '';
  const currentUrl = query === '' ? pathname : `${pathname}?${query}`;

  // Arrival is about to move the step on, so pushing would bounce the viewer.
  // Only a page the current step does not itself cover counts as ahead —
  // consecutive steps share a page and differ only by tab.
  const stepPattern = step?.route?.split('?')[0];
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

  // A scenario navigates only; opening the panel or the tab is the viewer's.
  React.useEffect(() => {
    if (wantedRoute === null || wantedRoute === currentUrl) return;
    if (walkedAhead) return;
    router.push(wantedRoute);
  }, [wantedRoute, currentUrl, walkedAhead, router]);

  const running = active !== null;
  const isCollapsed = active?.collapsed === true;

  React.useEffect(() => {
    if (!running) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        if (isTopmostOverlay()) stop();
        return;
      }
      // A walkthrough sits over a live page: an arrow key moving a caret must
      // not also move the step.
      if (isEditableTarget(event.target)) return;
      if (isCollapsed) return;
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
  }, [running, isCollapsed, stop, next, back]);

  const value = React.useMemo<TourContextValue>(
    () => ({ active, start, startScenario, stop, next, back, collapse, expand }),
    [active, start, startScenario, stop, next, back, collapse, expand],
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
          collapsed={active.collapsed}
          autoCollapse={active.crossesPages}
          onCollapse={collapse}
          onExpand={expand}
          onNext={next}
          onBack={back}
          onClose={stop}
        />
      )}
    </Ctx.Provider>
  );
}
