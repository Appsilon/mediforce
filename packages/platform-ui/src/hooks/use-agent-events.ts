'use client';

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AgentEvent, InstanceStatus } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { CRITICAL_LIVE_INTERVAL_MS, TERMINAL_STATUSES } from '@/lib/polling-cadence';
import { stopRetryOn4xx } from '@/lib/retry';

/**
 * Agent event log for a process instance, react-query backed. Mirrors the
 * step-execution polling rhythm: CRITICAL LIVE (1.5 s) while the parent run
 * is non-terminal, stopped once `completed` / `failed` per ADR-0006 §4.
 *
 * Powered by `mediforce.processes.agentEvents` which returns events sorted
 * by `sequence` ascending. Optional `stepId` narrows to one step.
 *
 * Every poll re-reads the full log and merges by `id`. `sequence` cannot carry
 * a cursor: it restarts at 0 for every step, and for the same step after a
 * worker restart. The rows are a few status markers per step, so a full read is
 * cheap — the log lines live in the step-log file.
 */
export function useAgentEvents(
  instanceId: string | null | undefined,
  stepId: string | null | undefined,
  instanceStatus: InstanceStatus | undefined,
): { data: AgentEvent[]; loading: boolean; error: Error | null } {
  const enabled = instanceId !== null && instanceId !== undefined && instanceId.length > 0;
  const isTerminal = instanceStatus !== undefined && TERMINAL_STATUSES.has(instanceStatus);

  // Per-(instance, step) accumulator. The key guards against a stale buffer
  // bleeding into a different feed when the inputs change mid-mount.
  const accumulator = useRef<{ key: string; events: AgentEvent[] }>({
    key: '',
    events: [],
  });

  const query = useQuery({
    queryKey: enabled
      ? queryKeys.agentEvents(instanceId, stepId)
      : queryKeys.agentEvents('__noop__', null),
    queryFn: async () => {
      if (instanceId === null || instanceId === undefined) {
        throw new Error('unreachable: enabled gates this');
      }
      const key = `${instanceId}:${stepId ?? ''}`;
      if (accumulator.current.key !== key) {
        accumulator.current = { key, events: [] };
      }
      const seen = accumulator.current.events;
      const result = await mediforce.processes.agentEvents({
        instanceId,
        stepId: stepId ?? undefined,
      });
      const merged = mergeEvents(seen, result.events);
      accumulator.current = { key, events: merged };
      return merged.slice();
    },
    enabled,
    refetchInterval: (q) => {
      // PRD §9 rule 4: stop polling on 4xx so a deleted instance does not
      // tight-loop at 1.5s.
      if (q.state.error !== null) return false;
      return isTerminal ? false : CRITICAL_LIVE_INTERVAL_MS;
    },
    retry: stopRetryOn4xx,
  });

  return {
    data: query.data ?? [],
    loading: enabled && query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}

/**
 * Merge the freshly-read log into the accumulated one, de-duped by `id`. Not by
 * `sequence`: two steps of the same run both number from 0, so a sequence key
 * silently drops one step's event for every collision. Sorted by timestamp,
 * which is the order a reader of a whole run wants.
 */
function mergeEvents(
  existing: readonly AgentEvent[],
  delta: readonly AgentEvent[],
): AgentEvent[] {
  if (delta.length === 0) return existing.slice();
  const byId = new Map<string, AgentEvent>();
  for (const event of existing) byId.set(event.id, event);
  for (const event of delta) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => {
    const byTime = Date.parse(a.timestamp) - Date.parse(b.timestamp);
    if (Number.isNaN(byTime) === false && byTime !== 0) return byTime;
    // Same millisecond: keep a step's own events together and in order, rather
    // than interleaving two steps by numbers that count different things.
    if (a.stepId !== b.stepId) return a.stepId < b.stepId ? -1 : 1;
    return a.sequence - b.sequence;
  });
}
