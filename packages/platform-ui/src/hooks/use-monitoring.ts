'use client';

import { useQuery } from '@tanstack/react-query';
import type { MonitoringSummary } from '@mediforce/platform-api/contract';
import { ACTIONABLE_STATUSES } from '@mediforce/platform-api/contract';
import type { HumanTask, ProcessInstance } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { NICE_LIVE_INTERVAL_MS, STANDARD_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';
import { useProcessInstances } from './use-process-instances';

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
  instances: ProcessInstance[];
  tasks: HumanTask[];
  loading: boolean;
}

/**
 * Monitoring tabs page data — composes the compact `useMonitoringSummary`
 * aggregate (kept alive here so the summary request still fires; the
 * Workflows tab's KPI cards derive their counts from `instances` directly
 * via `getWorkflowStatus` instead) with the row-level headless hooks the
 * tabs' tables/lists need (`useProcessInstances`, `mediforce.tasks.list`).
 * STANDARD LIVE per ADR-0006 §4 for the row-level reads.
 */
export function useMonitoringData(handle: string | undefined): MonitoringData {
  const { loading: summaryLoading } = useMonitoringSummary(handle);

  const { data: instances, loading: instancesLoading } = useProcessInstances(
    'all',
    undefined,
    false,
    handle ?? '',
  );

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
  const tasks = tasksQuery.data ?? [];

  return {
    instances,
    tasks,
    loading: summaryLoading || instancesLoading || tasksQuery.isLoading,
  };
}
