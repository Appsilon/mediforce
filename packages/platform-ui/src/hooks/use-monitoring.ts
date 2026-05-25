'use client';

import { useMemo } from 'react';
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
  statusCounts: {
    running: number;
    paused: number;
    failed: number;
    completed: number;
    created: number;
  };
  stuckProcesses: ProcessInstance[]; // paused instances, sorted oldest first
  roleCounts: Array<{ role: string; pending: number; claimed: number; total: number }>;
  loading: boolean;
}

/**
 * Monitoring tabs page data — composes the compact `useMonitoringSummary`
 * aggregate (counts, role breakdown) with the row-level headless hooks the
 * tabs' tables/lists need (`useProcessInstances`, `mediforce.tasks.list`).
 * STANDARD LIVE per ADR-0006 §4 for the row-level reads.
 */
export function useMonitoringData(handle: string | undefined): MonitoringData {
  const { data: summary, loading: summaryLoading } = useMonitoringSummary(handle);

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

  const statusCounts = useMemo(
    () => ({
      running: summary?.runs.running ?? 0,
      paused: summary?.runs.paused ?? 0,
      failed: summary?.runs.failed ?? 0,
      completed: summary?.runs.completed ?? 0,
      created: instances.filter((inst) => inst.status === 'created').length,
    }),
    [summary, instances],
  );

  const stuckProcesses = useMemo(
    () =>
      instances
        .filter((inst) => inst.status === 'paused')
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [instances],
  );

  const roleCounts = useMemo(
    () =>
      Object.entries(summary?.roleTaskCounts ?? {})
        .map(([role, counts]) => ({
          role,
          pending: counts.pending,
          claimed: counts.claimed,
          total: counts.pending + counts.claimed,
        }))
        .sort((a, b) => b.total - a.total),
    [summary],
  );

  return {
    instances,
    tasks,
    statusCounts,
    stuckProcesses,
    roleCounts,
    loading: summaryLoading || instancesLoading || tasksQuery.isLoading,
  };
}
