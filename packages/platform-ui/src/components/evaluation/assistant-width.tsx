'use client';

import * as React from 'react';

const ASSISTANT_WIDTH_KEY = 'mediforce.evaluation-assistant.width';
const DEFAULT_ASSISTANT_WIDTH = 380;
const MIN_ASSISTANT_WIDTH = 320;
// The evaluation sections keep at least this much room, plus the 1rem column gap.
const MIN_SECTIONS_WIDTH = 360;
const COLUMN_GAP = 16;
const KEYBOARD_RESIZE_STEP = 32;

/** The grid columns beside the assistant; min() keeps a remembered width from squeezing the content on a narrower window. */
export function assistantColumns(width: number): string {
  return `minmax(0,1fr) min(${width}px, calc(100% - ${MIN_SECTIONS_WIDTH + COLUMN_GAP}px))`;
}

const MIN_ASSISTANT_HEIGHT = 360;
const ASSISTANT_BOTTOM_GAP = 24;

function scrollParent(element: HTMLElement): HTMLElement {
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return document.documentElement;
}

/**
 * The assistant's height: what is left of the scrolling viewport below where
 * the panel starts, so its input shows without scrolling the page, however
 * much sits above it. Re-measured as the viewport or the content above changes.
 */
export function useAssistantHeight(): { ref: (panel: HTMLDivElement | null) => void; height: number | undefined } {
  const [panel, setPanel] = React.useState<HTMLDivElement | null>(null);
  const [height, setHeight] = React.useState<number | undefined>(undefined);
  React.useEffect(() => {
    if (panel === null) return;
    const scroller = scrollParent(panel);
    const measure = () => {
      const top = panel.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      setHeight(Math.max(MIN_ASSISTANT_HEIGHT, Math.round(scroller.clientHeight - top - ASSISTANT_BOTTOM_GAP)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    for (const child of Array.from(scroller.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [panel]);
  return { ref: setPanel, height };
}

/** The assistant column's width: dragged or arrow-keyed from its left edge, remembered per browser. */
export function useAssistantWidth(layoutRef: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = React.useState(DEFAULT_ASSISTANT_WIDTH);

  React.useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(ASSISTANT_WIDTH_KEY));
      if (Number.isFinite(stored) && stored >= MIN_ASSISTANT_WIDTH) setWidth(stored);
    } catch {
      // Storage unavailable (private window, blocked site data): keep the default.
    }
  }, []);

  const clamp = (next: number) => {
    const available = (layoutRef.current?.clientWidth ?? Number.POSITIVE_INFINITY) - MIN_SECTIONS_WIDTH - COLUMN_GAP;
    return Math.round(Math.max(MIN_ASSISTANT_WIDTH, Math.min(next, available)));
  };
  const resize = (next: number) => setWidth(clamp(next));
  const persist = (next: number) => {
    try {
      localStorage.setItem(ASSISTANT_WIDTH_KEY, String(next));
    } catch {
      // Not remembered; the width still applies for this visit.
    }
  };
  const commit = (next: number) => {
    const clamped = clamp(next);
    setWidth(clamped);
    persist(clamped);
  };
  return { width, resize, persist, commit };
}

export function AssistantResizeHandle({ width, resize, persist, commit }: ReturnType<typeof useAssistantWidth>) {
  const drag = React.useRef<{ startX: number; startWidth: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize Evaluation Assistant"
      aria-valuenow={width}
      aria-valuemin={MIN_ASSISTANT_WIDTH}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      data-testid="evaluation-assistant-resize"
      className="group absolute -left-4 top-0 z-10 hidden h-full w-4 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none lg:flex"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { startX: event.clientX, startWidth: width };
      }}
      onPointerMove={(event) => {
        if (drag.current === null) return;
        resize(drag.current.startWidth + drag.current.startX - event.clientX);
      }}
      onPointerUp={() => {
        if (drag.current === null) return;
        drag.current = null;
        persist(width);
      }}
      onDoubleClick={() => commit(DEFAULT_ASSISTANT_WIDTH)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') commit(width + KEYBOARD_RESIZE_STEP);
        else if (event.key === 'ArrowRight') commit(width - KEYBOARD_RESIZE_STEP);
        else return;
        event.preventDefault();
      }}
    >
      <div className="h-12 w-1 rounded-full bg-border transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary" />
    </div>
  );
}
