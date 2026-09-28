'use client';

import * as React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The search box the run panels share. A clear button rather than only the
 * keyboard: a filter you cannot see how to undo is how people conclude a panel
 * is broken.
 */
export function SearchField({ value, onChange, placeholder, className }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(
          'h-9 w-full rounded-md border bg-background pl-8 pr-8 text-sm',
          'placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          // Safari draws its own clear affordance on `type=search`; ours is the
          // one that matches the app and works in every browser.
          '[&::-webkit-search-cancel-button]:appearance-none',
        )}
      />
      {value !== '' && (
        <button
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
