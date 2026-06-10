'use client';

import { useQuery } from '@tanstack/react-query';
import type { InstanceStatus } from '@mediforce/platform-core';
import type { RunOutputFileEntry } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { STANDARD_LIVE_INTERVAL_MS, TERMINAL_STATUSES } from '@/lib/polling-cadence';
import { stopRetryOn4xx } from '@/lib/retry';

/**
 * Output Files committed on the run branch, react-query backed
 * (`mediforce.runs.listOutputFiles`).
 *
 * Polling: STANDARD LIVE (5 s) while the parent run is non-terminal — files
 * appear as steps complete, not sub-second — stopped once `completed` /
 * `failed` per ADR-0006 §4. Callers pass `instanceStatus` to gate the
 * cadence; `undefined` means "not yet known" and is treated as non-terminal.
 */
export function useRunOutputFiles(
  runId: string | null | undefined,
  instanceStatus: InstanceStatus | undefined,
): { data: RunOutputFileEntry[]; loading: boolean; error: Error | null } {
  const enabled = runId !== null && runId !== undefined && runId.length > 0;
  const isTerminal = instanceStatus !== undefined && TERMINAL_STATUSES.has(instanceStatus);

  const query = useQuery({
    queryKey: enabled
      ? queryKeys.runOutputFiles(runId)
      : queryKeys.runOutputFiles('__noop__'),
    queryFn: async () => {
      if (runId === null || runId === undefined) {
        throw new Error('unreachable: enabled gates this');
      }
      const result = await mediforce.runs.listOutputFiles({ runId });
      return result.files;
    },
    enabled,
    refetchInterval: (q) => {
      // PRD §9 rule 4: hooks must terminate on 4xx. A run deleted while the
      // page is open (404) or a workspace membership change (403) would
      // tight-loop forever at 5s otherwise.
      if (q.state.error !== null) return false;
      return isTerminal ? false : STANDARD_LIVE_INTERVAL_MS;
    },
    retry: stopRetryOn4xx,
  });

  return {
    data: query.data ?? [],
    loading: enabled && query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}
