'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';

type Trigger = Awaited<ReturnType<typeof mediforce.triggers.list>>['triggers'][number];
export type CronTrigger = Extract<Trigger, { type: 'cron' }>;
export type ManualTrigger = Extract<Trigger, { type: 'manual' }>;
export type WebhookTrigger = Extract<Trigger, { type: 'webhook' }>;

/**
 * Live trigger rows for a workflow, react-query backed. Single source of truth
 * for both the workflow header (enabled/schedule summary) and the Triggers tab —
 * mutations invalidate `workflowTriggers` so both refresh in the same tick.
 *
 * Reflects the unified `triggers` table (ADR-0011), NOT the advisory triggers
 * declared on a definition version. ONE-SHOT per ADR-0006 §4 — refetch on focus
 * plus explicit `invalidate()` after mutations keeps the cache fresh.
 */
export function useWorkflowTriggers(
  name: string,
  namespace: string,
): {
  triggers: Trigger[];
  cronTriggers: CronTrigger[];
  manualTriggers: ManualTrigger[];
  webhookTriggers: WebhookTrigger[];
  loading: boolean;
  error: Error | null;
  invalidate: () => Promise<void>;
} {
  const queryClient = useQueryClient();
  const enabled = name.length > 0 && namespace.length > 0;

  const query = useQuery({
    queryKey: enabled
      ? queryKeys.workflowTriggers(namespace, name)
      : queryKeys.workflowTriggers('__noop__', '__noop__'),
    queryFn: async () => {
      if (!enabled) throw new Error('unreachable: enabled gates this');
      const { triggers } = await mediforce.triggers.list({ definitionName: name, namespace });
      return triggers;
    },
    enabled,
    retry: stopRetryOn4xx,
  });

  const triggers = query.data ?? [];
  const cronTriggers = triggers.filter((t): t is CronTrigger => t.type === 'cron');
  const manualTriggers = triggers.filter((t): t is ManualTrigger => t.type === 'manual');
  const webhookTriggers = triggers.filter((t): t is WebhookTrigger => t.type === 'webhook');

  const invalidate = useCallback(async () => {
    if (!enabled) return;
    await queryClient.invalidateQueries({
      queryKey: queryKeys.workflowTriggers(namespace, name),
    });
  }, [queryClient, namespace, name, enabled]);

  return {
    triggers,
    cronTriggers,
    manualTriggers,
    webhookTriggers,
    loading: enabled && query.isPending,
    error: (query.error as Error | null) ?? null,
    invalidate,
  };
}
