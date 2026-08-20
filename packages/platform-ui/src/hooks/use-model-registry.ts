'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { NICE_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';
import type { ModelPricing } from '@/lib/agent-cost';

/**
 * Platform-wide model id → pricing lookup, synced from OpenRouter. Pricing
 * changes rarely, so NICE LIVE (30 s) is plenty — matches the cadence used
 * for other low-change reference data (e.g. the run name map).
 */
export function useModelPricing(): Map<string, ModelPricing> {
  const query = useQuery({
    queryKey: queryKeys.modelRegistry.list(),
    queryFn: async () => {
      const result = await mediforce.models.list();
      return result.models;
    },
    staleTime: NICE_LIVE_INTERVAL_MS,
    refetchInterval: (q) => (q.state.error !== null ? false : NICE_LIVE_INTERVAL_MS),
    retry: stopRetryOn4xx,
  });

  const models = query.data ?? [];
  return useMemo(() => {
    const map = new Map<string, ModelPricing>();
    for (const model of models) map.set(model.id, model.pricing);
    return map;
  }, [models]);
}
