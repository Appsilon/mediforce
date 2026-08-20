'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError, mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import {
  CRITICAL_LIVE_INTERVAL_MS,
  TERMINAL_STATUSES,
} from '@/lib/polling-cadence';

/**
 * Single process instance. CRITICAL LIVE per ADR-0006 §4 (1.5s poll) while
 * the run is non-terminal. Polling stops automatically once status enters
 * `completed` / `failed` — the operator no longer needs sub-second freshness.
 *
 * Powered by `mediforce.processes.get` which returns the full
 * `ProcessInstance` shape (vs the narrower `runs.get` projection), because
 * detail-page consumers read `namespace`, `archived`, `variables`, etc.
 */
export function useProcessInstance(instanceId: string | null) {
  const enabled = instanceId !== null && instanceId.length > 0;
  const query = useQuery({
    queryKey: enabled ? queryKeys.run(instanceId) : (['run', '__noop__'] as const),
    queryFn: () => mediforce.processes.get({ instanceId: instanceId as string }),
    enabled,
    retry: stopRetryOn4xx,
    refetchInterval: (q) => {
      if (q.state.error !== null) return false;
      const status = q.state.data?.status;
      if (status === undefined) return CRITICAL_LIVE_INTERVAL_MS;
      return TERMINAL_STATUSES.has(status) ? false : CRITICAL_LIVE_INTERVAL_MS;
    },
  });

  const err = enabled ? (query.error as Error | null) ?? null : null;
  const notFound = err instanceof ApiError && err.status === 404;

  // `isPending` (no data yet) keeps the skeleton on while the query is
  // running its first fetch; gated by `enabled` so a deliberate `null` id
  // surfaces `loading: false` (caller knows it isn't asking for anything).
  return {
    data: notFound ? null : query.data ?? null,
    loading: enabled && query.isPending,
    error: notFound ? null : err,
    notFound,
  };
}
