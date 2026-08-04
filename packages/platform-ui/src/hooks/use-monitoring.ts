'use client';

import { useQuery } from '@tanstack/react-query';
import type { MonitoringSummary } from '@mediforce/platform-api/contract';
import { ACTIONABLE_STATUSES } from '@mediforce/platform-api/contract';
import type { HumanTask } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { NICE_LIVE_INTERVAL_MS, STANDARD_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';

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

export interface MonitoringData {
  tasks: HumanTask[];
}

/**
 * Monitoring tabs page data — composes the compact `useMonitoringSummary`
 * aggregate (kept alive here so the summary request still fires) with the
 * row-level headless hooks the tabs' tables/lists need
 * (`mediforce.tasks.list`). STANDARD LIVE per ADR-0006 §4 for the row-level
 * reads.
 *
 * Deliberately does NOT fetch process instances here — the Workflows tab
 * used to use an unbounded run list (up to 10k rows, on every
 * Monitoring page load regardless of active tab) purely to JS-count KPI
 * cards; it now reads `mediforce.runs.statusCounts` (a real SQL
 * aggregation) and `AllRunsPanel` paginates its own row-level fetch. See
 * workflows-tab.tsx.
 *
 * No `loading` field — Tasks tab (the only consumer) doesn't gate any UI
 * on it; each tab's own hooks own their own loading state.
 */
export function useMonitoringData(handle: string | undefined): MonitoringData {
  useMonitoringSummary(handle);

  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks.byNamespace(handle ?? '', { status: [...ACTIONABLE_STATUSES] }),
    queryFn: async () => {
      const result = await mediforce.tasks.list({
        namespace: handle as string,
        status: [...ACTIONABLE_STATUSES],
      });
      return result.tasks;
    },
    enabled: handle !== undefined && handle.length > 0,
    retry: stopRetryOn4xx,
    refetchInterval: (q) => (q.state.error !== null ? false : STANDARD_LIVE_INTERVAL_MS),
  });

  return {
    tasks: tasksQuery.data ?? [],
  };
}
