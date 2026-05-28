'use client';

import * as React from 'react';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { onSnapshot, collection } from 'firebase/firestore';
import type { InstanceStatus } from '@mediforce/platform-core';
import { ApiError, mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { db } from '@/lib/firebase';

export type ProcessStatusFilter = 'all' | 'running' | 'paused' | 'completed' | 'failed' | 'created';

const STANDARD_LIVE_INTERVAL_MS = 5_000;
const CRITICAL_LIVE_INTERVAL_MS = 1_500;
const TERMINAL_STATUSES: ReadonlySet<InstanceStatus> = new Set([
  'completed',
  'failed',
]);

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
        // Parity workaround — tracked in #588. Pre-PR3 the UI did an
        // unbounded Firestore read; pagination on the contract isn't here
        // yet, so we ride the schema max instead of regressing visibility.
        limit: 10000,
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

  return {
    data,
    loading: query.isLoading && namespace.length > 0,
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

  return {
    data: notFound ? null : query.data ?? null,
    loading: query.isLoading && enabled,
    error: notFound ? null : err,
    notFound,
  };
}

/**
 * Step-execution / agent-event subcollection reader. Stays on Firestore
 * `onSnapshot` for now — the corresponding read endpoints are not in PR3's
 * scope (step execution detail moves with PR2's agent-runs migration; the
 * dedicated "process steps" endpoint covers the aggregate view consumed by
 * the run detail page).
 */
export function useSubcollection<T extends { id: string }>(
  parentPath: string,
  subcollection: string,
) {
  const [state, setState] = React.useState<{ data: T[]; loading: boolean; error: Error | null }>({
    data: [],
    loading: true,
    error: null,
  });

  React.useEffect(() => {
    if (!parentPath) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    const colRef = collection(db, parentPath, subcollection);
    const unsub = onSnapshot(colRef, (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as T[];
      setState({ data: docs, loading: false, error: null });
    }, (error) => {
      setState((prev) => ({ ...prev, loading: false, error }));
    });
    return unsub;
  }, [parentPath, subcollection]);

  return state;
}
