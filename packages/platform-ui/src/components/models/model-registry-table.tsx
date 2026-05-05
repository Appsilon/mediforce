'use client';

import { useState, useMemo } from 'react';
import { Search, ArrowUp, ArrowDown } from 'lucide-react';
import type { ModelRegistryEntry } from '@mediforce/platform-core';

type SortField = 'name' | 'provider' | 'contextLength' | 'pricingInput' | 'pricingOutput';
type SortDir = 'asc' | 'desc';

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${String(Math.round(tokens / 1_000_000))}M`;
  return `${String(Math.round(tokens / 1000))}K`;
}

function formatPrice(perToken: number): string {
  const perMillion = perToken * 1_000_000;
  if (perMillion === 0) return 'free';
  if (perMillion < 0.01) return `$${perMillion.toFixed(4)}`;
  return `$${perMillion.toFixed(2)}`;
}

interface ModelRegistryTableProps {
  models: ModelRegistryEntry[];
}

export function ModelRegistryTable({ models }: ModelRegistryTableProps) {
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [toolsFilter, setToolsFilter] = useState(false);
  const [visionFilter, setVisionFilter] = useState(false);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const providers = useMemo(() => {
    const set = new Set(models.map((m) => m.provider));
    return Array.from(set).sort();
  }, [models]);

  const filtered = useMemo(() => {
    let result = models;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.provider.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q),
      );
    }
    if (providerFilter) {
      result = result.filter((m) => m.provider === providerFilter);
    }
    if (toolsFilter) {
      result = result.filter((m) => m.supportsTools);
    }
    if (visionFilter) {
      result = result.filter((m) => m.supportsVision);
    }
    return result;
  }, [models, search, providerFilter, toolsFilter, visionFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'provider':
          cmp = a.provider.localeCompare(b.provider);
          break;
        case 'contextLength':
          cmp = a.contextLength - b.contextLength;
          break;
        case 'pricingInput':
          cmp = a.pricing.input - b.pricing.input;
          break;
        case 'pricingOutput':
          cmp = a.pricing.output - b.pricing.output;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortField, sortDir]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? (
      <ArrowUp className="inline h-3 w-3 ml-1" />
    ) : (
      <ArrowDown className="inline h-3 w-3 ml-1" />
    );
  }

  return (
    <div className="space-y-4">
      {/* Search + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder="Search models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <select
          aria-label="Provider"
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">All providers</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            aria-label="Tools"
            checked={toolsFilter}
            onChange={(e) => setToolsFilter(e.target.checked)}
            className="rounded border"
          />
          Tools
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            aria-label="Vision"
            checked={visionFilter}
            onChange={(e) => setVisionFilter(e.target.checked)}
            className="rounded border"
          />
          Vision
        </label>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th
                className="px-3 py-2 text-left font-medium cursor-pointer select-none"
                onClick={() => handleSort('name')}
              >
                Name
                <SortIcon field="name" />
              </th>
              <th
                className="px-3 py-2 text-left font-medium cursor-pointer select-none"
                onClick={() => handleSort('provider')}
              >
                Provider
                <SortIcon field="provider" />
              </th>
              <th
                className="px-3 py-2 text-right font-medium cursor-pointer select-none"
                onClick={() => handleSort('contextLength')}
              >
                Context
                <SortIcon field="contextLength" />
              </th>
              <th
                className="px-3 py-2 text-right font-medium cursor-pointer select-none"
                onClick={() => handleSort('pricingInput')}
              >
                In $/M
                <SortIcon field="pricingInput" />
              </th>
              <th
                className="px-3 py-2 text-right font-medium cursor-pointer select-none"
                onClick={() => handleSort('pricingOutput')}
              >
                Out $/M
                <SortIcon field="pricingOutput" />
              </th>
              <th className="px-3 py-2 text-center font-medium">Tools</th>
              <th className="px-3 py-2 text-center font-medium">Vision</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sorted.map((model) => (
              <tr key={model.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2 font-medium">{model.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{model.provider}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatContext(model.contextLength)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatPrice(model.pricing.input)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatPrice(model.pricing.output)}</td>
                <td className="px-3 py-2 text-center">{model.supportsTools ? '✓' : ''}</td>
                <td className="px-3 py-2 text-center">{model.supportsVision ? '✓' : ''}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  {models.length === 0
                    ? 'No models in registry. Sync from OpenRouter to populate.'
                    : 'No models match your filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Count */}
      <p className="text-sm text-muted-foreground">
        Showing {sorted.length} of {models.length} models
      </p>
    </div>
  );
}
