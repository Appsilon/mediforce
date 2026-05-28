'use client';

import { useQuery } from '@tanstack/react-query';
import type { HumanTask, HumanTaskStatus } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';

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
} {
  const query = useQuery({
    queryKey: queryKeys.task(taskId ?? ''),
    queryFn: () => mediforce.tasks.get({ taskId: taskId as string }),
    enabled: taskId !== undefined,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status === undefined) return CRITICAL_LIVE_INTERVAL_MS;
      return TERMINAL.has(status) ? false : CRITICAL_LIVE_INTERVAL_MS;
    },
  });

  return {
    task: taskId === undefined ? null : query.data ?? null,
    loading: query.isLoading && taskId !== undefined,
    error: taskId === undefined ? null : (query.error as Error | null) ?? null,
  };
}
