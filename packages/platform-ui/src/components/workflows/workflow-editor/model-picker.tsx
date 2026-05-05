'use client';

import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '@/lib/api-fetch';
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
  const [customInput, setCustomInput] = useState(false);

  useEffect(() => {
    apiFetch('/api/model-registry')
      .then((res) => res.json())
      .then((data: { models: ModelRegistryEntry[] }) => setModels(data.models))
      .catch(() => {});
  }, []);

  const topPicks = useMemo(() =>
    models
      .filter((m) => m.requestCount !== null && m.requestCount > 0)
      .sort((a, b) => (b.requestCount ?? 0) - (a.requestCount ?? 0))
      .slice(0, TOP_PICKS_COUNT),
    [models],
  );

  const selectedModel = useMemo(() => {
    if (!value) return null;
    return models.find((m) => m.id === value) ?? null;
  }, [models, value]);

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
            className={className}
            list="model-registry-list"
          />
          <button
            type="button"
            onClick={() => setCustomInput(false)}
            className="shrink-0 rounded-md border px-2 py-1 text-xs hover:bg-accent transition-colors"
          >
            ← List
          </button>
        </div>
        <datalist id="model-registry-list">
          {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </datalist>
        {selectedModel && <ModelMeta model={selectedModel} />}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select
          value={value ?? ''}
          onChange={(e) => {
            if (e.target.value === '__custom__') {
              setCustomInput(true);
              return;
            }
            onChange(e.target.value || undefined);
          }}
          className={className}
        >
          <option value="">Default ({displayDefault})</option>
          <optgroup label="Top picks">
            {topPicks.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} — {formatContext(m.contextLength)}, in:{formatPrice(m.pricing.input)}
              </option>
            ))}
          </optgroup>
          <option value="__custom__">Custom model ID...</option>
          {isCustom && <option value={value}>{value}</option>}
        </select>
      </div>
      {(selectedModel ?? (value === '' || value === undefined ? defaultModelMeta(models, defaultModel) : null)) && (
        <ModelMeta model={(selectedModel ?? defaultModelMeta(models, defaultModel))!} />
      )}
    </div>
  );
}

function defaultModelMeta(models: ModelRegistryEntry[], defaultModel?: string): ModelRegistryEntry | null {
  if (!defaultModel) return null;
  return models.find((m) => m.id === defaultModel || m.name === defaultModel) ?? null;
}

function ModelMeta({ model }: { model: ModelRegistryEntry }) {
  return (
    <div className="flex gap-3 text-xs text-muted-foreground">
      <span>{formatContext(model.contextLength)} context</span>
      <span>in:{formatPrice(model.pricing.input)}</span>
      <span>out:{formatPrice(model.pricing.output)}</span>
      {model.supportsTools && <span>tools ✓</span>}
      {model.supportsVision && <span>vision ✓</span>}
      {model.requestCount !== null && model.requestCount > 0 && (
        <span>{model.requestCount >= 1_000_000 ? `${(model.requestCount / 1_000_000).toFixed(1)}M` : `${Math.round(model.requestCount / 1000)}K`} requests</span>
      )}
    </div>
  );
}
