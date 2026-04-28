'use client';

import { cn } from '@/lib/utils';
import { Wrench } from 'lucide-react';
import type { ToolCatalogEntry } from '@mediforce/platform-core';

interface CatalogListProps {
  entries: ToolCatalogEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function CatalogList({ entries, selectedId, onSelect }: CatalogListProps) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Wrench className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">No catalog entries yet.</p>
        <p className="text-xs text-muted-foreground">
          Add your first to enable stdio MCP servers for agents.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {entries.map((entry) => {
        const isSelected = entry.id === selectedId;
        return (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => onSelect(entry.id)}
              className={cn(
                'w-full px-4 py-3 text-left transition-colors hover:bg-muted/40',
                isSelected && 'bg-muted',
              )}
            >
              <div className="font-mono text-sm font-medium">{entry.id}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                <span className="font-mono">{entry.command}</span>
                {(entry.args?.length ?? 0) > 0 && (
                  <span className="ml-1 font-mono">{entry.args?.join(' ')}</span>
                )}
              </div>
              {entry.description !== undefined && entry.description !== '' && (
                <div className="mt-1 truncate text-xs text-muted-foreground">{entry.description}</div>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
