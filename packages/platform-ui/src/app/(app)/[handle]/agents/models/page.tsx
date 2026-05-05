'use client';

import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { ModelRegistryTable } from '@/components/models/model-registry-table';
import type { ModelRegistryEntry } from '@mediforce/platform-core';

export default function ModelsPage() {
  const [models, setModels] = useState<ModelRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/api/model-registry')
      .then((res) => res.json())
      .then((data: { models: ModelRegistryEntry[] }) => {
        setModels(data.models);
        if (data.models.length > 0) {
          const latest = data.models.reduce((a, b) =>
            a.lastSyncedAt > b.lastSyncedAt ? a : b,
          );
          setLastSynced(latest.lastSyncedAt);
        }
      })
      .catch(() => setError('Failed to load models.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await apiFetch('/api/model-registry/sync', { method: 'POST' });
      const data = await res.json();
      setLastSynced(data.lastSyncedAt);
      const listRes = await apiFetch('/api/model-registry');
      const listData = await listRes.json();
      setModels(listData.models);
    } finally {
      setSyncing(false);
    }
  }

  function formatRelativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${String(mins)}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${String(hours)}h ago`;
    const days = Math.floor(hours / 24);
    return `${String(days)}d ago`;
  }

  return (
    <div className="p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Model Registry</h1>
          <p className="text-sm text-muted-foreground mt-1">
            LLM models synced from OpenRouter. Use this data when selecting models for workflow steps.
          </p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          {lastSynced && (
            <span className="text-xs text-muted-foreground">
              Synced {formatRelativeTime(lastSynced)}
            </span>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 rounded-md bg-muted/50 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-300">
          {error}
        </div>
      ) : (
        <ModelRegistryTable models={models} />
      )}
    </div>
  );
}
