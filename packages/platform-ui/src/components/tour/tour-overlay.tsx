'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Compass, X } from 'lucide-react';
import {
  cardPlacement,
  clampToViewport,
  isFullyVisible,
  type Box,
  type Size,
  type TourStep,
} from '@/lib/tour';
import { cn } from '@/lib/utils';

const CARD_WIDTH = 340;
const FALLBACK_CARD_HEIGHT = 200;
const SPOTLIGHT_PADDING = 6;
/** Skip and Back are the same weight of control, so they share one definition. */
const SECONDARY_BUTTON =
  'inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium transition-colors hover:bg-muted';
const MEASURE_INTERVAL_MS = 200;

/**
 * The first *visible* match, not the first match: the sidebar renders twice
 * (a `md:`-gated desktop copy and a mobile drawer), so on a phone the first
 * one in the DOM is the hidden desktop nav.
 */
function findTarget(target: string | undefined): Element | null {
  if (target === undefined) return null;
  const candidates = [...document.querySelectorAll(`[data-tour="${target}"]`)];
  return candidates.find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }) ?? null;
}

function readTarget(target: string | undefined): Box | null {
  const element = findTarget(target);
  if (element === null) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === null || b === null) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

/**
 * Re-reads the target every frame-ish rather than observing it. The element a
 * step points at is often mounted late (a list waiting on its query) or moved
 * by a panel opening, and one cheap poll covers both without three observers.
 */
function useTargetBox(target: string | undefined): Box | null {
  const [box, setBox] = React.useState<Box | null>(() => readTarget(target));

  React.useEffect(() => {
    if (target === undefined) {
      setBox(null);
      return;
    }
    let current = readTarget(target);
    setBox(current);
    const element = findTarget(target);
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    // Instant, and only when it is actually needed: a smooth scroll animates
    // the target out from under a ring that can only catch up on the next
    // measurement, which looks like the highlight coming apart.
    if (element instanceof HTMLElement && (current === null || !isFullyVisible(current, viewport))) {
      element.scrollIntoView({ block: 'center', behavior: 'auto' });
      current = readTarget(target);
      setBox(current);
    }

    function remeasure(): void {
      const next = readTarget(target);
      if (sameBox(current, next)) return;
      current = next;
      setBox(next);
    }

    const timer = window.setInterval(remeasure, MEASURE_INTERVAL_MS);
    window.addEventListener('scroll', remeasure, { capture: true, passive: true });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('scroll', remeasure, { capture: true });
    };
  }, [target]);

  return box;
}

export function TourOverlay({
  title,
  step,
  index,
  total,
  onNext,
  onBack,
  onClose,
}: {
  title: string;
  step: TourStep;
  index: number;
  total: number;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const box = useTargetBox(step.target);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const [cardHeight, setCardHeight] = React.useState(FALLBACK_CARD_HEIGHT);
  const [viewport, setViewport] = React.useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  React.useEffect(() => {
    function onResize(): void {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  React.useLayoutEffect(() => {
    const measured = cardRef.current?.offsetHeight;
    if (measured !== undefined && measured > 0) setCardHeight(measured);
  }, [step.id, box]);

  // Clicking Guide must land a keyboard user somewhere, and each Next has to
  // re-announce: the card is the only thing that changed.
  React.useEffect(() => {
    cardRef.current?.focus();
  }, [step.id]);

  React.useEffect(() => {
    const opener = document.activeElement;
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  const spotlight = box === null ? null : clampToViewport(box, viewport);
  const placed = cardPlacement(spotlight, viewport, { width: CARD_WIDTH, height: cardHeight });
  const isLast = index === total - 1;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[100] print:hidden" data-testid="tour-overlay">
      {spotlight !== null ? (
        <div
          className="absolute rounded-md ring-2 ring-primary transition-all duration-200"
          style={{
            top: spotlight.top - SPOTLIGHT_PADDING,
            left: spotlight.left - SPOTLIGHT_PADDING,
            width: spotlight.width + SPOTLIGHT_PADDING * 2,
            height: spotlight.height + SPOTLIGHT_PADDING * 2,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
          }}
        />
      ) : (
        <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0, 0, 0, 0.55)' }} />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-label={`${title}: ${step.title}`}
        aria-describedby="tour-step-body"
        tabIndex={-1}
        data-testid="tour-card"
        className="pointer-events-auto absolute rounded-lg border bg-popover text-popover-foreground shadow-lg outline-none animate-in fade-in-0 zoom-in-95"
        style={{ top: placed.top, left: placed.left, width: CARD_WIDTH }}
      >
        <div className="flex items-start gap-2.5 border-b px-4 py-2.5">
          <Compass className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Guide · {title}
            </p>
            <h2 className="font-headline text-sm font-semibold leading-snug">{step.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="End walkthrough"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <p id="tour-step-body" className="px-4 py-3 text-sm text-muted-foreground">
          {step.body}
        </p>

        <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <span className="text-xs tabular-nums text-muted-foreground">
              {index + 1} of {total}
            </span>
            <button
              type="button"
              onClick={onClose}
              className={SECONDARY_BUTTON}
            >
              Skip
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              disabled={index === 0}
              className={cn(SECONDARY_BUTTON, 'disabled:pointer-events-none disabled:opacity-40')}
            >
              Back
            </button>
            <button
              type="button"
              onClick={isLast ? onClose : onNext}
              className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>

        <p className="border-t px-4 py-1.5 text-center text-[11px] text-muted-foreground/70">
          You can use <kbd className="font-sans">←</kbd> <kbd className="font-sans">→</kbd> to navigate
        </p>
      </div>
    </div>,
    document.body,
  );
}
