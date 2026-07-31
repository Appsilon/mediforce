'use client';

import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ProcessInstance, WorkflowDisplayStatus } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { STANDARD_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';

const PAGE_SIZE = 20;

/**
 * Keyset-paginated, newest-first run list — replaces the old "fetch up to
 * 10k rows, filter client-side" approach (`useProcessInstances`) for the
 * Monitoring → Workflows tab and the standalone `/runs` page, both of which
 * became unusably slow once a real workspace accumulated thousands of runs.
 *
 * Every filter (`dryRun`, `archived`, `displayStatus`) is pushed server-side
 * so a 20-row page reflects the true filtered set, not a client-side slice
 * of an arbitrary 20 rows that happened to load first.
 *
 * STANDARD LIVE polling refetches every already-loaded page in cursor order
 * (TanStack Query's native infinite-query refetch behavior) — "Load more"
 * state survives a poll tick.
 */
export function useProcessInstancesPage(params: {
  namespace: string;
  workflowFilter?: string;
  dryRun?: boolean;
  archived: boolean;
  displayStatus?: WorkflowDisplayStatus | null;
}) {
  const { namespace, workflowFilter, dryRun, archived, displayStatus } = params;
  const enabled = namespace.length > 0;

  const query = useInfiniteQuery({
    queryKey: queryKeys.runs.page(namespace, {
      workflow: workflowFilter,
      dryRun,
      archived,
      displayStatus: displayStatus ?? undefined,
    }),
    queryFn: async ({ pageParam }) =>
      mediforce.runs.listPage({
        namespace,
        workflow: workflowFilter,
        dryRun,
        archived,
        displayStatus: displayStatus ?? undefined,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
    retry: stopRetryOn4xx,
    refetchInterval: (q) => (q.state.error !== null ? false : STANDARD_LIVE_INTERVAL_MS),
  });

  const items = useMemo<ProcessInstance[]>(
    () => query.data?.pages.flatMap((p) => p.runs) ?? [],
    [query.data],
  );

  return {
    data: items,
    loading: enabled && query.isPending,
    error: (query.error as Error | null) ?? null,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => {
      void query.fetchNextPage();
    },
  };
}
