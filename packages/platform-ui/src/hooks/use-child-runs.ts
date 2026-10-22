'use client';

import { useQuery } from '@tanstack/react-query';
import type { ProcessInstance } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { STANDARD_LIVE_INTERVAL_MS, TERMINAL_STATUSES } from '@/lib/polling-cadence';

/**
 * The runs a run spawned directly. STANDARD LIVE until the run and every
 * child are terminal.
 */
export function useChildRuns(run: Pick<ProcessInstance, 'id' | 'status'>, enabled: boolean) {
  return useQuery<ProcessInstance[], Error>({
    queryKey: queryKeys.runs.children(run.id),
    queryFn: async () => (await mediforce.runs.list({ parent: run.id, limit: 10000 })).runs,
    enabled,
    retry: stopRetryOn4xx,
    refetchInterval: (query) => {
      if (query.state.error !== null) return false;
      const settled = TERMINAL_STATUSES.has(run.status)
        && (query.state.data ?? []).every((child) => TERMINAL_STATUSES.has(child.status));
      return settled ? false : STANDARD_LIVE_INTERVAL_MS;
    },
  });
}
