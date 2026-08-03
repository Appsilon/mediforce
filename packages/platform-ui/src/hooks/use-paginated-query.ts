'use client';

import { useMemo } from 'react';
import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { stopRetryOn4xx } from '@/lib/retry';
import { STANDARD_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';

interface CursorPage {
  nextCursor?: string;
}

/**
 * Shared keyset-pagination shape for Monitoring's paginated list hooks
 * (`useProcessInstancesPage`, `useAgentRunsPage`, `useNamespaceAuditEventsPage`)
 * — one `useInfiniteQuery` wrapper instead of three near-identical copies.
 * Each caller supplies its own query key, page fetcher, and how to pull the
 * item array out of its page shape (`runs` vs `events` field names differ
 * per endpoint, so that step can't be hard-coded here).
 *
 * STANDARD LIVE polling refetches every already-loaded page in cursor
 * order — "Load more" state survives a poll tick.
 */
export function usePaginatedQuery<TPage extends CursorPage, TItem>(params: {
  queryKey: QueryKey;
  queryFn: (cursor: string | undefined) => Promise<TPage>;
  selectItems: (page: TPage) => TItem[];
  enabled: boolean;
}) {
  const { queryKey, queryFn, selectItems, enabled } = params;

  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => queryFn(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
    retry: stopRetryOn4xx,
    refetchInterval: (q) => (q.state.error !== null ? false : STANDARD_LIVE_INTERVAL_MS),
  });

  const items = useMemo<TItem[]>(
    () => query.data?.pages.flatMap((page) => selectItems(page)) ?? [],
    [query.data, selectItems],
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
