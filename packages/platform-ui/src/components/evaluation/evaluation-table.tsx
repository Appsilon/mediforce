'use client';

import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InstantTooltip } from '@/components/ui/instant-tooltip';

export const tableWrapperClass = 'overflow-x-auto rounded-md border';
export const tableHeaderRowClass = 'border-b bg-muted text-left text-xs text-muted-foreground';

export interface TableColumn {
  key: string;
  label: React.ReactNode;
  /** Said in a tooltip on the header, reachable by keyboard. */
  help?: string;
  className?: string;
}

/** A table's header row from its columns; a row's full-width details span `columns.length`. */
export function TableHead({ columns }: { columns: readonly TableColumn[] }) {
  return (
    <thead>
      <tr className={tableHeaderRowClass}>
        {columns.map((column) => (
          <th key={column.key} className={cn('px-3 py-2 font-medium', column.className)}>
            {column.help === undefined ? column.label : (
              <InstantTooltip label={column.help}>
                <span tabIndex={0}>{column.label}</span>
              </InstantTooltip>
            )}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** A full-width row under a table row: its details, or a form editing it. */
export function DetailsRow({ columns, className, children, testId }: {
  columns: number;
  className?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <tr>
      <td colSpan={columns} className={cn('bg-muted/20 px-3 pb-3 pt-1', className)} data-testid={testId}>{children}</td>
    </tr>
  );
}

/** A link-styled button that opens and closes what it names, its chevron turning with it. */
export function DisclosureButton({ open, onToggle, children, ...rest }: {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
} & Pick<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & { 'data-testid'?: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
      onClick={onToggle}
      {...rest}
    >
      {children}
      <ChevronRight className={cn('h-3 w-3 transition-transform', open === true && 'rotate-90')} />
    </button>
  );
}
