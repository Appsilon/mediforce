'use client';

import type { WorkflowDisplayStatus } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { usePaginatedQuery } from './use-paginated-query';

const PAGE_SIZE = 20;

/**
 * Keyset-paginated run list (newest-first by default) — replaces the old "fetch up to
 * 10k rows, filter client-side" approach of the retired unbounded list hook for the
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
  sort: 'started' | 'cost';
  direction: 'asc' | 'desc';
}) {
  const { namespace, workflowFilter, dryRun, archived, displayStatus, sort, direction } = params;
  const enabled = namespace.length > 0;

  return usePaginatedQuery({
    queryKey: queryKeys.runs.page(namespace, {
      workflow: workflowFilter,
      dryRun,
      archived,
      displayStatus: displayStatus ?? undefined,
      sort,
      direction,
    }),
    queryFn: (cursor) =>
      mediforce.runs.listPage({
        namespace,
        workflow: workflowFilter,
        dryRun,
        archived,
        displayStatus: displayStatus ?? undefined,
        sort,
        direction,
        cursor,
        limit: PAGE_SIZE,
      }),
    selectItems: (page) => page.runs,
    enabled,
  });
}
