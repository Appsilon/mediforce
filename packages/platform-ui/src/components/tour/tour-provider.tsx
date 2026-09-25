'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { isEditableTarget } from '@/components/command-palette/provider';
import { chapterForPath, type TourStep } from '@/lib/tour';
import { GUIDE_CHAPTERS } from '@/lib/tour-content';
import { DEMO_SCENARIOS } from '@/lib/demo-content';
import { nextRouteAction, routeParams, startingIndex } from '@/lib/demo';
import { useDemoRun } from '@/hooks/use-demo-run';
import { TourOverlay } from './tour-overlay';

type TourState = {
  /** Gates five behaviours: ending on navigation, navigating, the run lookup,
   *  auto-collapse, and advancing on arrival. */
  kind: 'guide' | 'scenario';
  title: string;
  steps: readonly TourStep[];
  index: number;
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
    setActive({ kind: 'guide', title: chapter.title, steps: chapter.steps, index: 0, collapsed: false });
  }, [pathname]);

  const startScenario = React.useCallback((scenarioId: string) => {
    const scenario = DEMO_SCENARIOS.find((entry) => entry.id === scenarioId);
    if (scenario === undefined) return;
    setActive({
      kind: 'scenario',
      title: scenario.title,
      steps: scenario.steps,
      // Starting "run it" from a run should not march the viewer back to the
      // workflow page to work forwards again.
      index: startingIndex(scenario.steps, pathname),
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

  const step = active === null ? null : active.steps[active.index] ?? null;
  const [unreachable, setUnreachable] = React.useState<string | null>(null);

  const needsRun =
    active?.kind === 'scenario'
    && active.steps.some((entry) => routeParams(entry).some((param) => param !== ':handle'));
  // `(app)` also serves `/workspaces`, where the first segment is not a handle.
  const handle = pathname.split('/')[1] ?? '';
  const demoRun = useDemoRun(handle === 'workspaces' ? '' : handle, needsRun === true);

  const query = searchParams?.toString() ?? '';
  const currentUrl = query === '' ? pathname : `${pathname}?${query}`;

  // A guide is about the page you are on, so leaving ends it.
  React.useEffect(() => {
    setActive((prev) => (prev === null || prev.kind === 'guide' ? null : prev));
  }, [pathname]);

  // Arrival is the viewer walking to a later step's page, so it is applied only
  // when the URL actually changed. Without this, stepping Back re-ran it on the
  // page you were already on and threw you forward again.
  const arrivedFrom = React.useRef<string | null>(null);

  // A scenario navigates only; opening the panel or the tab is the viewer's.
  React.useEffect(() => {
    if (active === null || active.kind !== 'scenario') {
      arrivedFrom.current = null;
      return;
    }
    const action = nextRouteAction({
      steps: active.steps,
      index: active.index,
      pathname,
      currentUrl,
      run: demoRun,
    });
    if (action.kind === 'advance') {
      const navigated = arrivedFrom.current !== currentUrl;
      arrivedFrom.current = currentUrl;
      if (navigated) {
        setActive((prev) => (prev === null ? null : { ...prev, index: action.index, collapsed: false }));
      }
      return;
    }
    arrivedFrom.current = currentUrl;
    if (action.kind === 'navigate') router.push(action.url);
    setUnreachable(action.kind === 'unreachable' ? action.needs : null);
  }, [active, pathname, currentUrl, demoRun, router]);

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
          kind={active.kind}
          title={active.title}
          step={step}
          action={step.action}
          unreachable={unreachable}
          index={active.index}
          total={active.steps.length}
          collapsed={active.collapsed}
          autoCollapse={active.kind === 'scenario'}
          onCollapse={collapse}
          onNext={next}
          onBack={back}
          onClose={stop}
        />
      )}
    </Ctx.Provider>
  );
}
