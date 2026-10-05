'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Cpu, Search } from 'lucide-react';
import type { ModelRegistryEntry } from '@mediforce/platform-core';
import { useModelRegistry } from '@/hooks/use-model-registry';
import { AnthropicLogo, DeepSeekLogo, GeminiLogo, OpenAILogo, type LogoProps } from '@/lib/agent-models';
import { cn } from '@/lib/utils';

const PROVIDER_LOGOS: Record<string, { Logo: React.ComponentType<LogoProps>; color: string }> = {
  anthropic: { Logo: AnthropicLogo, color: '#D97757' },
  openai: { Logo: OpenAILogo, color: '#10a37f' },
  google: { Logo: GeminiLogo, color: '#4285F4' },
  deepseek: { Logo: DeepSeekLogo, color: '#4D6BFE' },
};

function providerOf(modelId: string): string {
  return modelId.split('/')[0] ?? modelId;
}

function ProviderLogo({ modelId }: { modelId: string }) {
  const brand = PROVIDER_LOGOS[providerOf(modelId).toLowerCase()];
  if (brand === undefined) return <Cpu className="h-4 w-4 shrink-0 text-muted-foreground" />;
  return <brand.Logo className="h-4 w-4 shrink-0" style={{ color: brand.color }} />;
}

const MAX_VISIBLE = 100;

interface ModelPickerProps {
  value: string;
  onChange: (modelId: string) => void;
}

export function ModelPicker({ value, onChange }: ModelPickerProps) {
  const { data, isLoading, isError } = useModelRegistry();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const models = useMemo(() => {
    const active = (data ?? []).filter((model) => model.retiredAt === null);
    return active.sort((a, b) => (b.requestCount ?? 0) - (a.requestCount ?? 0));
  }, [data]);

  const selected: ModelRegistryEntry | undefined = (data ?? []).find((model) => model.id === value);

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query === '') return models;
    return models.filter(
      (model) => model.name.toLowerCase().includes(query) || model.id.toLowerCase().includes(query),
    );
  }, [models, search]);

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (containerRef.current !== null && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        data-tour="agent-new-model"
        className={cn(
          'flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-sm transition-colors',
          'hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-ring',
          open && 'ring-2 ring-ring border-ring',
        )}
      >
        {value !== '' ? (
          <span className="flex items-center gap-2 min-w-0">
            <ProviderLogo modelId={value} />
            <span className="truncate">{selected?.name ?? value}</span>
            <span className="text-muted-foreground text-xs shrink-0">— {selected?.provider ?? providerOf(value)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Select a model…</span>
        )}
        <ChevronDown
          className={cn('h-4 w-4 text-muted-foreground shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search models…"
              className="w-full bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {isLoading && <p className="px-3 py-2 text-sm text-muted-foreground">Loading models…</p>}
            {isError && <p className="px-3 py-2 text-sm text-destructive">Could not load models.</p>}
            {!isLoading && !isError && matches.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">No models match.</p>
            )}
            {matches.slice(0, MAX_VISIBLE).map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => {
                  onChange(model.id);
                  setOpen(false);
                  setSearch('');
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-accent transition-colors',
                  value === model.id && 'bg-accent',
                )}
              >
                <ProviderLogo modelId={model.id} />
                <span className="flex-1 truncate">{model.name}</span>
                <span className="text-xs text-muted-foreground">{model.provider}</span>
                {value === model.id && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            ))}
            {matches.length > MAX_VISIBLE && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Showing {MAX_VISIBLE} of {matches.length} — type to narrow the list.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
