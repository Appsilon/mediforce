'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { NICE_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';
import { useParams } from 'next/navigation';
import { DEFAULT_MODEL, effectiveDefaultModel, isUsableDefaultModel, modelVendor, pinDefaultJudgeModel, pinDefaultModel } from '@mediforce/platform-core';
import { useAuth } from '@/contexts/auth-context';
import { useNamespace } from '@/hooks/use-namespace';
import { useNamespaceMembers } from '@/hooks/use-namespace-members';
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
 * The signed-in member's own default model in `handle`, else the workspace's;
 * `model` is undefined when neither is set. `ready` once both have loaded.
 */
export function usePreferredDefaultModel(handle: string): { model: string | undefined; ready: boolean } {
  const { user } = useAuth();
  const { namespace, loading } = useNamespace(handle);
  const { members, loading: membersLoading } = useNamespaceMembers(handle);
  const model = effectiveDefaultModel(
    namespace?.defaultModel,
    members.find((member) => member.uid === user?.id)?.defaultModel,
  );
  return { model, ready: loading === false && membersLoading === false };
}

/** The model a call nobody saved a model for runs on in `handle`, as the server resolves it (`resolveDefaultModel`). */
export function useDefaultModel(handle: string): string {
  const registry = useModelRegistry();
  const preferred = usePreferredDefaultModel(handle).model;
  const entry = registry.data?.find((model) => model.id === preferred);
  return preferred !== undefined && isUsableDefaultModel(entry) ? preferred : DEFAULT_MODEL;
}

/**
 * The concrete model a new agent, step or judge starts on: the member's or
 * workspace's default while the registry lists it live (and, for a judge, it
 * can return structured output; for a plugin, it is one of `providers`), else
 * the newest Claude Sonnet (`pinDefaultModel`), its fallback until the registry loads.
 */
export function usePinnedDefaultModel(options: { judge?: boolean; providers?: readonly string[] } = {}): string {
  const query = useModelRegistry();
  const { handle } = useParams<{ handle?: string }>();
  const preferred = usePreferredDefaultModel(handle ?? '').model;
  const { judge, providers } = options;
  return useMemo(() => {
    const models = query.data ?? [];
    const allowed = preferred !== undefined && (providers === undefined || providers.includes(modelVendor(preferred))) ? preferred : undefined;
    return judge === true ? pinDefaultJudgeModel(models, allowed) : pinDefaultModel(models, allowed);
  }, [query.data, preferred, judge, providers]);
}
