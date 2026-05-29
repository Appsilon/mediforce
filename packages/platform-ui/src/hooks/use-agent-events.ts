'use client';

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AgentEvent, InstanceStatus } from '@mediforce/platform-core';
import { ApiError, mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { CRITICAL_LIVE_INTERVAL_MS, TERMINAL_STATUSES } from '@/lib/polling-cadence';

/**
 * Agent event log for a process instance, react-query backed. Mirrors the
 * step-execution polling rhythm: CRITICAL LIVE (1.5 s) while the parent run
 * is non-terminal, stopped once `completed` / `failed` per ADR-0006 §4.
 *
 * Powered by `mediforce.processes.agentEvents` which returns events sorted
 * by `sequence` ascending. Optional `stepId` narrows to one step.
 *
 * Incremental polling: the first fetch pulls the full log; each subsequent
 * poll sends `afterSequence = max(seen sequence)` so the API returns only the
 * delta, which we append to a per-key accumulator. An idle run costs ~1 read
 * per poll instead of re-reading the whole subcollection. Consumers still see
 * the full cumulative list sorted by `sequence` ASC — no behavioural change.
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
      const afterSequence =
        seen.length > 0 ? seen[seen.length - 1].sequence : undefined;
      const result = await mediforce.processes.agentEvents({
        instanceId,
        stepId: stepId ?? undefined,
        afterSequence,
      });
      const merged = mergeBySequence(seen, result.events);
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
    retry: (failureCount, err) => {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
      return failureCount < 2;
    },
  });

  return {
    data: query.data ?? [],
    loading: enabled && query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}

/**
 * Append delta events to the accumulated log, de-duped by `sequence` (the
 * monotonic ordering key — see `AgentEventSchema`) and kept sorted ASC. A
 * cursor-based delta should never overlap, but de-duping defends against a
 * retried poll that re-fetches the boundary event.
 */
function mergeBySequence(
  existing: readonly AgentEvent[],
  delta: readonly AgentEvent[],
): AgentEvent[] {
  if (delta.length === 0) return existing.slice();
  const bySequence = new Map<number, AgentEvent>();
  for (const event of existing) bySequence.set(event.sequence, event);
  for (const event of delta) bySequence.set(event.sequence, event);
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}
