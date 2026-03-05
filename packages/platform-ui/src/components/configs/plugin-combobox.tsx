'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Search, X, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PluginMetadata {
  name: string;
  description: string;
  inputDescription: string;
  outputDescription: string;
  roles: ('executor' | 'reviewer')[];
}

interface PluginEntry {
  name: string;
  metadata?: PluginMetadata;
}

interface PluginComboboxProps {
  plugins: PluginEntry[];
  value: string | undefined;
  onChange: (pluginName: string | undefined) => void;
  role: 'executor' | 'reviewer';
  disabled?: boolean;
}

export function PluginCombobox({
  plugins,
  value,
  onChange,
  role,
  disabled,
}: PluginComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter by role first
  const roleFiltered = useMemo(
    () => plugins.filter((p) => p.metadata?.roles?.includes(role)),
    [plugins, role],
  );

  // Then filter by search text
  const filtered = useMemo(() => {
    if (!search.trim()) return roleFiltered;
    const term = search.toLowerCase();
    return roleFiltered.filter(
      (p) =>
        (p.metadata?.name ?? p.name).toLowerCase().includes(term) ||
        (p.metadata?.description ?? '').toLowerCase().includes(term),
    );
  }, [roleFiltered, search]);

  const selectedPlugin = useMemo(
    () => plugins.find((p) => p.name === value),
    [plugins, value],
  );

  // Focus search input when popover opens
  useEffect(() => {
    if (open) {
      // Small delay to let the popover render
      const timer = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    } else {
      setSearch('');
    }
  }, [open]);

  return (
    <div className="flex items-center gap-1">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild disabled={disabled}>
          <button
            type="button"
            className={cn(
              'flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-sm',
              'hover:bg-muted/50 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
            role="combobox"
          >
            <span className={cn(!selectedPlugin && 'text-muted-foreground')}>
              {selectedPlugin
                ? selectedPlugin.metadata?.name ?? selectedPlugin.name
                : 'Select plugin...'}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-2" />
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            className="z-50 w-[var(--radix-popover-trigger-width)] rounded-md border bg-popover text-popover-foreground shadow-md"
            align="start"
            sideOffset={4}
          >
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search plugins..."
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div className="max-h-48 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                  No plugins found
                </div>
              ) : (
                filtered.map((plugin) => (
                  <button
                    key={plugin.name}
                    type="button"
                    onClick={() => {
                      onChange(plugin.name);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center px-3 py-2 text-sm text-left hover:bg-muted transition-colors',
                      value === plugin.name && 'bg-muted',
                    )}
                  >
                    <span>{plugin.metadata?.name ?? plugin.name}</span>
                  </button>
                ))
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {value && !disabled && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          aria-label="Clear selection"
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
