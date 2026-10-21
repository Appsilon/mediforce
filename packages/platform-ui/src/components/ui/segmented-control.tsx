'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A row of mutually exclusive options, one always chosen. */
export function SegmentedControl<Value extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: Array<{ value: Value; label: ReactNode; title?: string }>;
  onChange: (value: Value) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors',
            option.value === value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
