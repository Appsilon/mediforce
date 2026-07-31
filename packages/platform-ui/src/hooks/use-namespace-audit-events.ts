'use client';

import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { AuditEvent } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { STANDARD_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';

const PAGE_SIZE = 20;

/**
 * Keyset-paginated audit events for a workspace (Monitoring → Users / Tasks
 * tabs) — sign-ins, workflow triggers/cancels, task activity, across every
 * user. `actions` restricts server-side to the calling tab's own event set
 * (Users vs. Tasks each pass a different slice) so a 20-row page reflects
 * what that tab actually shows, not an arbitrary slice of the whole
 * namespace-wide log. `actorId`/`fromDate`/`toDate` are the User/date-range
 * filter controls, also pushed server-side.
 *
 * Replaces the old unbounded `useNamespaceAuditEvents(handle)` — no `limit`
 * meant "fetch the entire namespace audit log," the worst offender behind
 * the Monitoring page's real-data slowness (thousands of rows, one
 * unfiltered request, every 5s poll).
 *
 * STANDARD LIVE polling refetches every already-loaded page in cursor
 * order — "Load more" state survives a poll tick.
 */
export function useNamespaceAuditEventsPage(params: {
  namespace: string;
  actions: string[];
  actorId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
}) {
  const { namespace, actions, actorId, fromDate, toDate } = params;
  const enabled = namespace.length > 0;

  const query = useInfiniteQuery({
    queryKey: queryKeys.namespaceAuditEvents(namespace, {
      actions,
      actorId: actorId ?? undefined,
      fromDate: fromDate ?? undefined,
      toDate: toDate ?? undefined,
    }),
    queryFn: async ({ pageParam }) =>
      mediforce.processes.listNamespaceAuditEvents({
        namespace,
        actions,
        actorId: actorId ?? undefined,
        fromDate: fromDate ?? undefined,
        toDate: toDate ?? undefined,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
    retry: stopRetryOn4xx,
    refetchInterval: (q) => (q.state.error !== null ? false : STANDARD_LIVE_INTERVAL_MS),
  });

  const items = useMemo<AuditEvent[]>(
    () => query.data?.pages.flatMap((p) => p.events) ?? [],
    [query.data],
  );

  return {
    data: items,
    loading: enabled && query.isPending,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => {
      void query.fetchNextPage();
    },
  };
}

/**
 * uid → display name (falls back to email, then the uid itself) for a
 * workspace's members.
 */
export function useNamespaceMemberNames(handle: string): Map<string, string> {
  const enabled = handle.length > 0;
  const query = useQuery({
    queryKey: enabled ? queryKeys.namespaceMembers(handle) : queryKeys.namespaceMembers('__noop__'),
    queryFn: async () => mediforce.users.listMembers({ namespace: handle }),
    enabled,
    retry: stopRetryOn4xx,
    staleTime: 5 * 60 * 1000,
  });

  const members = query.data?.members ?? [];
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(member.uid, member.displayName ?? member.email ?? member.uid);
    }
    return map;
  }, [members]);
}
