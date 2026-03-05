'use client';

import { LayoutList, LayoutGrid, List } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TaskViewMode = 'table' | 'cards' | 'grouped';

const VIEWS: { mode: TaskViewMode; icon: React.ElementType; label: string }[] = [
  { mode: 'table', icon: LayoutList, label: 'Table' },
  { mode: 'cards', icon: LayoutGrid, label: 'Cards' },
  { mode: 'grouped', icon: List, label: 'Grouped' },
];

export function ViewToggle({
  value,
  onChange,
}: {
  value: TaskViewMode;
  onChange: (mode: TaskViewMode) => void;
}) {
  return (
    <div className="flex rounded-md border overflow-hidden">
      {VIEWS.map(({ mode, icon: Icon, label }) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          aria-label={label}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 px-3 text-xs font-medium transition-colors',
            value === mode
              ? 'bg-primary text-primary-foreground'
              : 'bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
