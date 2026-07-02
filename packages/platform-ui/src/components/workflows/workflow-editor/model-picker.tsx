'use client';

import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, Layers, ArrowDownToLine, ArrowUpFromLine, Wrench, Eye, TrendingUp } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { cn } from '@/lib/utils';
import type { ModelRegistryEntry } from '@mediforce/platform-core';

interface ModelPickerProps {
  value: string | undefined;
  onChange: (model: string | undefined) => void;
  defaultModel?: string;
  className?: string;
}

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${String(Math.round(tokens / 1_000_000))}M`;
  return `${String(Math.round(tokens / 1000))}K`;
}

function formatPrice(perToken: number): string {
  if (perToken <= 0 || Number.isNaN(perToken)) return 'free';
  const perMillion = perToken * 1_000_000;
  if (perMillion < 0.01) return `$${perMillion.toFixed(4)}/M`;
  return `$${perMillion.toFixed(2)}/M`;
}

const TOP_PICKS_COUNT = 20;

export function ModelPicker({ value, onChange, defaultModel, className }: ModelPickerProps) {
  const [models, setModels] = useState<ModelRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [customInput, setCustomInput] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch('/api/model-registry')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load models (${String(res.status)})`);
        return res.json();
      })
      .then((data: { models: ModelRegistryEntry[] }) => {
        setModels(data.models);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load models');
      })
      .finally(() => setLoading(false));
  }, []);

  // Prefer models with usage history, but fall back to the full (non-retired)
  // registry when no usage stats exist yet (e.g. a freshly-synced registry) —
  // otherwise the picker looks empty/broken even though models are available.
  const topPicks = useMemo(() => {
    const withUsage = models
      .filter((m) => m.retiredAt === null)
      .filter((m) => m.requestCount !== null && m.requestCount > 0)
      .sort((a, b) => (b.requestCount ?? 0) - (a.requestCount ?? 0));
    if (withUsage.length > 0) return withUsage.slice(0, TOP_PICKS_COUNT);
    return models.filter((m) => m.retiredAt === null).slice(0, TOP_PICKS_COUNT);
  }, [models]);

  const selectedModel = useMemo(() => {
    if (!value) return null;
    return models.find((m) => m.id === value) ?? null;
  }, [models, value]);

  const retiredModel = useMemo(() => {
    if (!selectedModel || selectedModel.retiredAt === null) return null;
    return selectedModel;
  }, [selectedModel]);

  const displayDefault = defaultModel ?? 'plugin default';
  const isCustom = value !== undefined && value !== '' && !topPicks.some((m) => m.id === value);

  if (customInput) {
    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || undefined)}
            placeholder="e.g. tencent/hy3-preview:free"
            className={cn(className, 'flex-1 min-w-0')}
            list="model-registry-list"
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setCustomInput(false)}
            className="shrink-0 rounded-md border px-2 py-1 text-xs hover:bg-accent transition-colors"
          >
            ← List
          </button>
        </div>
        <datalist id="model-registry-list">
          {models.filter((m) => m.retiredAt === null).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </datalist>
        {selectedModel && <ModelMeta model={selectedModel} />}
        {retiredModel && <RetiredWarning model={retiredModel} />}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select
          value={value ?? ''}
          disabled={loading}
          onChange={(e) => {
            if (e.target.value === '__custom__') {
              setCustomInput(true);
              return;
            }
            onChange(e.target.value || undefined);
          }}
          className={className}
        >
          <option value="">{loading ? 'Loading models…' : `Default (${displayDefault})`}</option>
          {topPicks.length > 0 && (
            <optgroup label="Top picks">
              {topPicks.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {formatContext(m.contextLength)}, in:{formatPrice(m.pricing.input)}
                </option>
              ))}
            </optgroup>
          )}
          <option value="__custom__">Custom model ID...</option>
          {isCustom && <option value={value}>{value}</option>}
        </select>
      </div>
      {loadError && (
        <p className="text-xs text-red-500">Couldn&apos;t load the model registry: {loadError}</p>
      )}
      {!loading && !loadError && models.length === 0 && (
        <p className="text-xs text-muted-foreground">No models in the registry yet. Enter a custom model ID instead.</p>
      )}
      {(selectedModel ?? (value === '' || value === undefined ? defaultModelMeta(models, defaultModel) : null)) && (
        <ModelMeta model={(selectedModel ?? defaultModelMeta(models, defaultModel))!} />
      )}
      {retiredModel && <RetiredWarning model={retiredModel} />}
    </div>
  );
}

function defaultModelMeta(models: ModelRegistryEntry[], defaultModel?: string): ModelRegistryEntry | null {
  if (!defaultModel) return null;
  return models.find((m) => m.id === defaultModel || m.name === defaultModel) ?? null;
}

function ModelMeta({ model }: { model: ModelRegistryEntry }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1"><Layers className="h-3.5 w-3.5 shrink-0" />{formatContext(model.contextLength)} context</span>
      <span className="inline-flex items-center gap-1"><ArrowDownToLine className="h-3.5 w-3.5 shrink-0" />{formatPrice(model.pricing.input)}</span>
      <span className="inline-flex items-center gap-1"><ArrowUpFromLine className="h-3.5 w-3.5 shrink-0" />{formatPrice(model.pricing.output)}</span>
      {model.supportsTools && <span className="inline-flex items-center gap-1"><Wrench className="h-3.5 w-3.5 shrink-0" />Tools</span>}
      {model.supportsVision && <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5 shrink-0" />Vision</span>}
      {model.requestCount !== null && model.requestCount > 0 && (
        <span className="inline-flex items-center gap-1">
          <TrendingUp className="h-3.5 w-3.5 shrink-0" />
          {model.requestCount >= 1_000_000 ? `${(model.requestCount / 1_000_000).toFixed(1)}M` : `${Math.round(model.requestCount / 1000)}K`} requests
        </span>
      )}
    </div>
  );
}

function RetiredWarning({ model }: { model: ModelRegistryEntry }) {
  const date = model.retiredAt
    ? new Date(model.retiredAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : '';
  return (
    <div
      data-testid="retired-model-warning"
      className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-md px-2.5 py-1.5"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>
        <strong>{model.name}</strong> was retired on {date}. Choose a different model before saving.
      </span>
    </div>
  );
}
