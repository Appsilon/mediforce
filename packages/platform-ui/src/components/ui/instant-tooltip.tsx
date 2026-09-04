'use client';

import * as React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';

/**
 * Wraps a control in a zero-delay tooltip. Renders children untouched when there
 * is no `label` (e.g. the button is enabled). Uses the wrapper as the trigger so
 * the tooltip still shows over a **disabled** button — a disabled `<button>`
 * swallows its own hover events, and the native `title` tooltip both misses that
 * and only appears after the browser's ~1s delay.
 *
 * That property is the whole point wherever a role gate greys a control out
 * (ADR-0019): a disabled button whose reason nobody can read is worse than the
 * 403 it is trying to prevent.
 */
export function InstantTooltip({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  if (label === undefined || label === '') return <>{children}</>;
  return (
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={6}
            className="z-50 max-w-xs rounded-lg border bg-popover px-3 py-2 text-xs shadow-md animate-in fade-in-0 zoom-in-95"
          >
            {label}
            <Tooltip.Arrow className="fill-popover" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
