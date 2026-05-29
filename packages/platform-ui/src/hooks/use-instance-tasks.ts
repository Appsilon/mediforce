'use client';

import { useQuery } from '@tanstack/react-query';
import type { HumanTask } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';

/**
 * Fetches every human task belonging to a single process instance.
 *
 * One-shot read: `refetchInterval: 0` (the project default per ADR-0006 §3).
 * Intended for historical / contextual views where stale data is acceptable —
 * task detail's sibling list, post-completion next-step lookup. For live task
 * inboxes use the role-scoped hooks (`useMyTasks`).
 */
export function useInstanceTasks(instanceId: string | undefined): {
  tasks: HumanTask[];
  loading: boolean;
  error: Error | null;
} {
  const query = useQuery({
    queryKey: queryKeys.tasks.byInstance(instanceId ?? ''),
    queryFn: async () => {
      const result = await mediforce.tasks.list({ instanceId: instanceId as string });
      return result.tasks;
    },
    enabled: instanceId !== undefined,
  });

  return {
    tasks: instanceId === undefined ? [] : query.data ?? [],
    loading: query.isLoading && instanceId !== undefined,
    error: instanceId === undefined ? null : (query.error as Error | null) ?? null,
  };
}
