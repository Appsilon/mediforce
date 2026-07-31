'use client';

import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { AgentRun, AgentRunStatus, AgentRunCardStatus } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { STANDARD_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';

const PAGE_SIZE = 20;

type Counts = { total: number; running: number; completed: number; error: number; flagged: number };
const ZERO_COUNTS: Counts = { total: 0, running: 0, completed: 0, error: 0, flagged: 0 };

/**
 * Keyset-paginated, newest-first agent-run list — replaces the old "fetch
 * up to 10k rows, filter client-side" approach (`useAgentRuns`) for the
 * Monitoring → Agents tab, which became unusably slow once a real
 * workspace accumulated thousands of runs.
 *
 * `status`/`cardStatus`/`processInstanceIds` are all pushed server-side so
 * a 20-row page reflects the true filtered set. STANDARD LIVE polling
 * refetches every already-loaded page in cursor order — "Load more" state
 * survives a poll tick.
 */
export function useAgentRunsPage(params: {
  namespace: string;
  status?: AgentRunStatus;
  cardStatus?: AgentRunCardStatus | null;
  processInstanceIds?: string[];
}) {
  const { namespace, status, cardStatus, processInstanceIds } = params;
  const enabled = namespace.length > 0;

  const query = useInfiniteQuery({
    queryKey: queryKeys.agentRuns.page(namespace, {
      status,
      cardStatus: cardStatus ?? undefined,
      processInstanceIds,
    }),
    queryFn: async ({ pageParam }) =>
      mediforce.agentRuns.list({
        namespace,
        status,
        cardStatus: cardStatus ?? undefined,
        processInstanceIds,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
    retry: stopRetryOn4xx,
    refetchInterval: (q) => (q.state.error !== null ? false : STANDARD_LIVE_INTERVAL_MS),
  });

  const items = useMemo<AgentRun[]>(
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

/**
 * Grouped `AgentRunCardStatus` counts for the Agents tab's KPI cards — a
 * real Postgres `COUNT(*) FILTER (WHERE ...)` aggregation, not a
 * client-side tally over a fetched row set.
 */
export function useAgentRunCardStatusCounts(params: {
  namespace: string;
  status?: AgentRunStatus;
  processInstanceIds?: string[];
}): { counts: Counts; loading: boolean } {
  const { namespace, status, processInstanceIds } = params;
  const enabled = namespace.length > 0;

  const query = useQuery({
    queryKey: queryKeys.agentRuns.cardStatusCounts(namespace, { status, processInstanceIds }),
    queryFn: async () => {
      const result = await mediforce.agentRuns.cardStatusCounts({ namespace, status, processInstanceIds });
      return result.counts;
    },
    enabled,
    retry: stopRetryOn4xx,
    refetchInterval: (q) => (q.state.error !== null ? false : STANDARD_LIVE_INTERVAL_MS),
  });

  return {
    counts: query.data ?? ZERO_COUNTS,
    loading: enabled && query.isPending,
  };
}
