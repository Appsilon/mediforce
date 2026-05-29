'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { InstanceStatus } from '@mediforce/platform-core';
import { ApiError, mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import {
  CRITICAL_LIVE_INTERVAL_MS,
  LEGACY_FIRESTORE_PARITY_LIMIT,
  STANDARD_LIVE_INTERVAL_MS,
  TERMINAL_STATUSES,
} from '@/lib/polling-cadence';

export type ProcessStatusFilter = 'all' | 'running' | 'paused' | 'completed' | 'failed' | 'created';

function statusForApi(filter: ProcessStatusFilter): InstanceStatus | undefined {
  return filter === 'all' ? undefined : filter;
}

/**
 * List process instances scoped to a workspace. STANDARD LIVE per ADR-0006 §4
 * (5s poll). Namespace gating is enforced server-side: `mediforce.runs.list`
 * sends the `namespace` filter to the platform-API, which intersects it with
 * the caller's allowed namespaces.
 *
 * The `showArchived` toggle is applied client-side because the wire schema
 * already filters `deleted` and there is no separate `archived` predicate on
 * the list endpoint; the over-fetch is bounded by the list `limit`.
 */
export function useProcessInstances(
  statusFilter: ProcessStatusFilter,
  definitionName: string | undefined,
  showArchived: boolean,
  namespace: string,
) {
  const apiStatus = statusForApi(statusFilter);
  const query = useQuery({
    queryKey: queryKeys.runs.byHandle(namespace, {
      workflow: definitionName,
      status: apiStatus,
    }),
    queryFn: async () => {
      const result = await mediforce.runs.list({
        namespace,
        workflow: definitionName,
        status: apiStatus,
        limit: LEGACY_FIRESTORE_PARITY_LIMIT,
      });
      return result.runs;
    },
    enabled: namespace.length > 0,
    refetchInterval: STANDARD_LIVE_INTERVAL_MS,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
      return failureCount < 2;
    },
  });

  const data = useMemo(() => {
    const runs = query.data ?? [];
    return runs.filter((inst) => showArchived || inst.archived !== true);
  }, [query.data, showArchived]);

  // While `namespace` hasn't resolved yet (route params still loading) the
  // query is disabled — `query.isPending` is true but `query.data` is also
  // undefined. Reporting `loading: false` in that window let the page render
  // its empty state ("No runs found.") before the first fetch even started.
  // Treat namespace-pending as loading so the skeleton holds.
  return {
    data,
    loading: namespace.length === 0 || query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}

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
    retry: (failureCount, err) => {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
      return failureCount < 2;
    },
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

