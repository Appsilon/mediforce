'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { NICE_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';
import { pinDefaultModel } from '@mediforce/platform-core';
import type { ModelPricing } from '@/lib/agent-cost';

export function useModelRegistry() {
  return useQuery({
    queryKey: queryKeys.modelRegistry.list(),
    queryFn: async () => {
      const result = await mediforce.models.list();
      return result.models;
    },
    staleTime: NICE_LIVE_INTERVAL_MS,
    refetchInterval: (q) => (q.state.error !== null ? false : NICE_LIVE_INTERVAL_MS),
    retry: stopRetryOn4xx,
  });
}

/**
 * Platform-wide model id → pricing lookup, synced from OpenRouter. Pricing
 * changes rarely, so NICE LIVE (30 s) is plenty — matches the cadence used
 * for other low-change reference data (e.g. the run name map).
 */
export function useModelPricing(): Map<string, ModelPricing> {
  const query = useModelRegistry();

  const models = query.data ?? [];
  return useMemo(() => {
    const map = new Map<string, ModelPricing>();
    for (const model of models) map.set(model.id, model.pricing);
    return map;
  }, [models]);
}

/**
 * The concrete model a saved default is pinned to — the newest Claude Sonnet
 * in the registry (`pinDefaultModel`), its fallback until the registry loads.
 */
export function usePinnedDefaultModel(): string {
  const query = useModelRegistry();
  return useMemo(() => pinDefaultModel(query.data ?? []), [query.data]);
}
