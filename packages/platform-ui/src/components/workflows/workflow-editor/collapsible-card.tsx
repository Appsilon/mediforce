'use client';

import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A self-contained collapsible section card.
 *
 * Cards stack directly in a panel column rather than nesting inside an outer
 * card, so the right rail reads as one level of surface. An open card takes the
 * remaining height and scrolls internally, which assumes the column keeps one
 * card open at a time.
 *
 * Shared by the step editor and the Add Block picker so the two views fold the
 * same way.
 */
export function CollapsibleCard({
  title,
  titleNode,
  headerAction,
  open,
  onToggle,
  fill = true,
  children,
}: {
  title?: string;
  titleNode?: React.ReactNode;
  headerAction?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  /**
   * Take the column's remaining height when open (the step editor's behaviour,
   * which relies on one card being open at a time). `false` sizes the card to
   * its content instead, so several short cards can be open without a
   * two-option section stretching down the whole panel.
   */
  fill?: boolean;
  children: React.ReactNode;
}) {
  const titleContent = titleNode ?? (
    <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">{title}</span>
  );
  return (
    <div className={cn('rounded-xl border shadow-lg overflow-hidden bg-white dark:bg-background flex flex-col', open && fill && 'flex-1 min-h-0')}>
      <div className="flex items-center gap-2 px-4 py-3 shrink-0">
        <button type="button" onClick={onToggle} className="flex flex-1 min-w-0 items-center gap-2 text-left cursor-pointer">
          {titleContent}
        </button>
        {headerAction}
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? 'Collapse section' : 'Expand section'}
          className="shrink-0 rounded-md p-1 text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')} strokeWidth={2} />
        </button>
      </div>
      {open && (
        <div className={cn('border-t px-4 pt-3.5 pb-4 space-y-4', fill && 'flex-1 overflow-y-auto min-h-0')}>
          {children}
        </div>
      )}
    </div>
  );
}
