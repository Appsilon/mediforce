'use client';

import { useQuery } from '@tanstack/react-query';
import type { MonitoringSummary } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { NICE_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';

/**
 * Workspace dashboard summary via `mediforce.monitoring.summary`. NICE LIVE
 * per ADR-0006 §4 — 30 s polling with focus-refetch so dashboards refresh on
 * tab return without burning RPS while idle.
 */
export function useMonitoringSummary(handle: string | undefined): {
  data: MonitoringSummary | null;
  loading: boolean;
  error: Error | null;
} {
  const query = useQuery({
    queryKey: queryKeys.monitoring.summary(handle ?? ''),
    queryFn: async () => {
      const result = await mediforce.monitoring.summary({ handle: handle as string });
      return result.summary;
    },
    enabled: handle !== undefined && handle.length > 0,
    // ADR-0006 §8a — 403 (not a member) and 404 (workspace gone) are terminal.
    retry: stopRetryOn4xx,
    refetchInterval: (q) => (q.state.error !== null ? false : NICE_LIVE_INTERVAL_MS),
    refetchOnWindowFocus: true,
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}
