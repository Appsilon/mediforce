'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';

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

export function usePlugins() {
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchPlugins() {
      try {
        const res = await fetch('/api/plugins');
        if (!res.ok) throw new Error(`Failed to fetch plugins: ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setPlugins(data.plugins ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchPlugins();
    return () => { cancelled = true; };
  }, []);

  const filterByRole = useCallback(
    (role: 'executor' | 'reviewer') =>
      plugins.filter((p) => p.metadata?.roles?.includes(role)),
    [plugins],
  );

  return { plugins, loading, error, filterByRole };
}
