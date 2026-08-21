'use client';

import { useQuery } from '@tanstack/react-query';
import type { WorkflowDisplayStatus } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { STANDARD_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';

type Counts = Record<WorkflowDisplayStatus, number>;

const ZERO_COUNTS: Counts = {
  in_progress: 0,
  waiting_for_human: 0,
  error: 0,
  cancelled: 0,
  completed: 0,
};

/**
 * Grouped `WorkflowDisplayStatus` counts for the Workflows tab's KPI cards
 * — a real Postgres `COUNT(*) FILTER (WHERE ...)` aggregation
 * (`getWorkflowStatusCounts` handler), not a client-side tally over a
 * fetched row set. Respects the same `dryRun`/`archived` filters
 * `AllRunsPanel`'s table applies, so a card's number always matches what
 * clicking it would filter the table to.
 */
export function useWorkflowStatusCounts(params: {
  namespace: string;
  workflowFilter?: string;
  dryRun?: boolean;
  archived: boolean;
}): { counts: Counts; loading: boolean } {
  const { namespace, workflowFilter, dryRun, archived } = params;
  const enabled = namespace.length > 0;

  const query = useQuery({
    queryKey: queryKeys.runs.statusCounts(namespace, { workflow: workflowFilter, dryRun, archived }),
    queryFn: async () => {
      const result = await mediforce.runs.statusCounts({
        namespace,
        workflow: workflowFilter,
        dryRun,
        archived,
      });
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
