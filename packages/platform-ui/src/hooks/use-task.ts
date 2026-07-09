'use client';

import { useQuery } from '@tanstack/react-query';
import type { HumanTask, HumanTaskStatus } from '@mediforce/platform-core';
import { ApiError, mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';

const TERMINAL: ReadonlySet<HumanTaskStatus> = new Set(['completed', 'cancelled']);
const CRITICAL_LIVE_INTERVAL_MS = 1500;

/**
 * Single-task detail fetch (`mediforce.tasks.get`) keyed under `['task', id]`.
 *
 * CRITICAL LIVE per ADR-0006 §4: polls at 1.5s while the task is non-terminal
 * (operator is watching execution), then stops polling once the task reaches
 * `completed` or `cancelled`. Cache stays warm for cross-route navigation.
 */
export function useTask(taskId: string | undefined): {
  task: HumanTask | null;
  loading: boolean;
  error: Error | null;
  notFound: boolean;
} {
  const query = useQuery({
    queryKey: queryKeys.task(taskId ?? ''),
    queryFn: () => mediforce.tasks.get({ taskId: taskId as string }),
    enabled: taskId !== undefined,
    // Validation / authorisation failures are not transient — a 4xx will keep
    // failing. Don't waste two retry attempts before showing the error.
    retry: stopRetryOn4xx,
    refetchInterval: (q) => {
      // Stop polling once the query has errored — a persistent 4xx (validation,
      // not-found, forbidden) does not recover on its own, and a 1.5s retry
      // loop spams the backend + flickers the UI.
      if (q.state.error !== null) return false;
      const status = q.state.data?.status;
      if (status === undefined) return CRITICAL_LIVE_INTERVAL_MS;
      return TERMINAL.has(status) ? false : CRITICAL_LIVE_INTERVAL_MS;
    },
  });

  const err = taskId === undefined ? null : (query.error as Error | null) ?? null;
  const notFound = err instanceof ApiError && err.status === 404;
  return {
    task: taskId === undefined ? null : query.data ?? null,
    loading: query.isLoading && taskId !== undefined,
    error: notFound ? null : err,
    notFound,
  };
}
