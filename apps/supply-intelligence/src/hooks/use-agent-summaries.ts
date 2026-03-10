'use client';

import { useCallback, useMemo } from 'react';
import { useCollection } from '@/hooks/use-collection';

export interface AgentSummary {
  id: string;
  scope: 'sku-pair' | 'category' | 'overview';
  scopeKey: string;
  narrative: string;
  generatedAt: string;
  agentRunId: string;
  model: string;
}

const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

export function useAgentSummaries() {
  const { data: summaries, loading, error } = useCollection<AgentSummary>('agentSummaries');

  const getOverviewSummary = useCallback(
    (): AgentSummary | undefined =>
      summaries.find((s) => s.scope === 'overview'),
    [summaries],
  );

  const getCategorySummary = useCallback(
    (category: string): AgentSummary | undefined =>
      summaries.find((s) => s.scope === 'category' && s.scopeKey === category),
    [summaries],
  );

  const getSkuPairSummary = useCallback(
    (skuId: string, warehouseId: string): AgentSummary | undefined =>
      summaries.find(
        (s) => s.scope === 'sku-pair' && s.scopeKey === `${skuId}|${warehouseId}`,
      ),
    [summaries],
  );

  const isStale = useMemo(() => {
    const overview = summaries.find((s) => s.scope === 'overview');
    if (!overview) return true;
    const age = Date.now() - new Date(overview.generatedAt).getTime();
    return age > STALE_THRESHOLD_MS;
  }, [summaries]);

  return {
    summaries,
    loading,
    error,
    getOverviewSummary,
    getCategorySummary,
    getSkuPairSummary,
    isStale,
  };
}
