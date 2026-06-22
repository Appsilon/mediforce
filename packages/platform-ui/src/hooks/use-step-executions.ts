'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { InstanceStatus, StepExecution } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { CRITICAL_LIVE_INTERVAL_MS, TERMINAL_STATUSES } from '@/lib/polling-cadence';
import { stopRetryOn4xx } from '@/lib/retry';

/**
 * Step-execution rows for a process instance, react-query backed.
 *
 * Powered by `mediforce.processes.steps` which returns one `StepEntry` per
 * step definition; the entry's `execution` field is `null` until the step
 * runs. We surface the materialised executions in the same shape the
 * pre-Phase-4 Firestore `stepExecutions` subcollection emitted (i.e. each
 * row already typed as `StepExecution` with `id`).
 *
 * Polling: CRITICAL LIVE (1.5 s) while the parent run is non-terminal,
 * stopped once `completed` / `failed` per ADR-0006 §4. Callers pass
 * `instanceStatus` to gate the cadence — `undefined` means "not yet known"
 * and is treated as non-terminal to keep the skeleton honest.
 */
export function useStepExecutions(
  instanceId: string | null | undefined,
  instanceStatus: InstanceStatus | undefined,
): { data: StepExecution[]; loading: boolean; error: Error | null } {
  const enabled = instanceId !== null && instanceId !== undefined && instanceId.length > 0;
  const isTerminal = instanceStatus !== undefined && TERMINAL_STATUSES.has(instanceStatus);

  const query = useQuery({
    queryKey: enabled ? queryKeys.processSteps(instanceId) : queryKeys.processSteps('__noop__'),
    queryFn: async () => {
      if (instanceId === null || instanceId === undefined) {
        throw new Error('unreachable: enabled gates this');
      }
      const result = await mediforce.processes.getSteps({ instanceId });
      return result.steps;
    },
    enabled,
    refetchInterval: (q) => {
      // PRD §9 rule 4: hooks must terminate on 4xx. A run deleted while the
      // page is open (404) or a workspace membership change (403) would
      // tight-loop forever at 1.5s otherwise.
      if (q.state.error !== null) return false;
      return isTerminal ? false : CRITICAL_LIVE_INTERVAL_MS;
    },
    retry: stopRetryOn4xx,
  });

  const executions = useMemo<StepExecution[]>(() => {
    const entries = query.data ?? [];
    const out: StepExecution[] = [];
    for (const entry of entries) {
      out.push(...entry.executions);
    }
    return out;
  }, [query.data]);

  return {
    data: executions,
    loading: enabled && query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}
