'use client';

import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { AuditEvent, InstanceStatus, ProcessInstance } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { STANDARD_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';

const TERMINAL_RUN_STATUSES: ReadonlySet<InstanceStatus> = new Set(['completed', 'failed']);

export type RunRef = Pick<ProcessInstance, 'id' | 'definitionName' | 'status'>;

export type RunAuditEvent = { run: RunRef; event: AuditEvent };

type AuditSlice = { data: AuditEvent[] | undefined; error: Error | null; isPending: boolean };

// Module-level so react-query keeps the combined array's identity stable.
function combineSlices(results: AuditSlice[]): AuditSlice[] {
  return results.map(({ data, error, isPending }) => ({ data, error, isPending }));
}

/**
 * The audit trail of a run together with the trails of the runs it spawned
 * directly, so an orchestrator's table reads as one case. The parent's own
 * events come from `useAuditEvents` (already polled by the detail page);
 * this adds the children. Children share `queryKeys.runs.children` with the
 * diagram's inline child workflows. STANDARD LIVE while anything is running.
 */
export function useRunTreeAuditEvents(
  run: RunRef,
  parentEvents: AuditEvent[],
  enabled: boolean,
): { data: RunAuditEvent[]; loading: boolean; error: Error | null } {
  const childrenQuery = useQuery({
    queryKey: queryKeys.runs.children(run.id),
    queryFn: async () => (await mediforce.runs.list({ parent: run.id, limit: 10000 })).runs,
    enabled,
    retry: stopRetryOn4xx,
    refetchInterval: (query) => {
      if (query.state.error !== null) return false;
      const settled = TERMINAL_RUN_STATUSES.has(run.status)
        && (query.state.data ?? []).every((child) => TERMINAL_RUN_STATUSES.has(child.status));
      return settled ? false : STANDARD_LIVE_INTERVAL_MS;
    },
  });

  const children = useMemo(() => childrenQuery.data ?? [], [childrenQuery.data]);

  const childAudits = useQueries({
    queries: children.map((child) => ({
      queryKey: queryKeys.audit(child.id),
      queryFn: async () => (await mediforce.processes.listAuditEvents({ instanceId: child.id })).events,
      enabled,
      retry: stopRetryOn4xx,
      refetchInterval: TERMINAL_RUN_STATUSES.has(child.status) ? false as const : STANDARD_LIVE_INTERVAL_MS,
    })),
    combine: combineSlices,
  });

  const data = useMemo(() => {
    const merged: RunAuditEvent[] = parentEvents.map((event) => ({ run, event }));
    children.forEach((child, index) => {
      for (const event of childAudits[index]?.data ?? []) merged.push({ run: child, event });
    });
    return merged.sort((a, b) => a.event.timestamp.localeCompare(b.event.timestamp));
  }, [run, parentEvents, children, childAudits]);

  const childError = childAudits.find((query) => query.error !== null)?.error ?? null;

  return {
    data,
    loading: enabled && (childrenQuery.isPending || childAudits.some((query) => query.isPending)),
    error: (childrenQuery.error as Error | null) ?? childError,
  };
}
