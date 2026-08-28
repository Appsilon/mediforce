'use client';

import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';

/**
 * Radix portals the content out of the panel's `overflow-y-auto` container and
 * flips it on collision — the two things a hand-rolled absolute fly-out gets
 * wrong here.
 */
export function HoverTooltip({
  content,
  side = 'left',
  children,
}: {
  content: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: React.ReactNode;
}) {
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={side}
            align="center"
            sideOffset={6}
            collisionPadding={8}
            className="z-[9999] max-w-xs rounded-lg bg-popover border border-border shadow-md px-2.5 py-2 text-xs text-popover-foreground leading-relaxed"
          >
            {content}
            <Tooltip.Arrow className="fill-popover" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
