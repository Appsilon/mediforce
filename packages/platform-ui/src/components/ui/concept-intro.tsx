'use client';

import * as Popover from '@radix-ui/react-popover';
import { HelpCircle, Info } from 'lucide-react';
import type { ReactNode } from 'react';

/** Shared body styling — the definition is wrapped in <strong> and renders as
 *  the emphasised lead-in, whether inline or inside the popover. */
const BODY = 'space-y-1.5 text-sm text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground';

/**
 * States what a concept is, on a surface that has a title to hang it off.
 * `label` names the concept for screen readers ("What is an agent?").
 */
export function ConceptPopover({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={label}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <HelpCircle className="h-4 w-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-96 rounded-lg border bg-popover p-3 shadow-md animate-in fade-in-0 zoom-in-95"
        >
          <div className={BODY}>{children}</div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The same statement, inline, for surfaces with no title to anchor a trigger
 * to — the agent create and configure forms, where the explanation stands in
 * for a page header.
 */
export function ConceptIntro({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg border bg-muted/40 px-4 py-3">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      <div className={BODY}>{children}</div>
    </div>
  );
}
