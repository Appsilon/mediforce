'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuditEvent, InstanceStatus, ProcessInstance } from '@mediforce/platform-core';
import { ApiError, mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';

const CRITICAL_LIVE_INTERVAL_MS = 1500;
const TERMINAL_RUN_STATUSES: ReadonlySet<InstanceStatus> = new Set(['completed', 'failed']);

/**
 * Audit-trail feed for a single run. CRITICAL LIVE per ADR-0006 §4 while the
 * parent run is non-terminal (operator watching execution), then idle once the
 * run reaches `completed` / `failed`. The terminal-state gate is read from the
 * `['run', id]` query cache populated by `useProcessInstance`; if that cache
 * is cold (audit page loaded directly), we keep polling because we cannot
 * prove the run is terminal.
 */
export function useAuditEvents(processInstanceId: string | null): {
  data: AuditEvent[];
  loading: boolean;
  error: Error | null;
} {
  const qc = useQueryClient();
  const enabled = processInstanceId !== null && processInstanceId.length > 0;
  const query = useQuery({
    queryKey: enabled ? queryKeys.audit(processInstanceId) : ['audit', '__noop__'] as const,
    queryFn: async () => {
      const result = await mediforce.processes.listAuditEvents({ instanceId: processInstanceId as string });
      return result.events;
    },
    enabled,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
      return failureCount < 2;
    },
    refetchInterval: (q) => {
      if (q.state.error !== null) return false;
      if (!enabled) return false;
      const run = qc.getQueryData<ProcessInstance>(queryKeys.run(processInstanceId as string));
      if (run !== undefined && TERMINAL_RUN_STATUSES.has(run.status)) return false;
      return CRITICAL_LIVE_INTERVAL_MS;
    },
  });

  const data = useMemo(() => {
    const events = query.data ?? [];
    return [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [query.data]);

  return {
    data,
    loading: query.isLoading && enabled,
    error: (query.error as Error | null) ?? null,
  };
}
