'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AgentRun, AgentRunStatus } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import {
  CRITICAL_LIVE_INTERVAL_MS,
  NICE_LIVE_INTERVAL_MS,
  STANDARD_LIVE_INTERVAL_MS,
} from '@/lib/polling-cadence';

const TERMINAL: ReadonlySet<AgentRunStatus> = new Set([
  'completed',
  'timed_out',
  'low_confidence',
  'error',
  'escalated',
  'flagged',
]);

/**
 * Agent runs for a specific (processInstanceId, stepId). STANDARD LIVE so the
 * step-detail page reflects newly-spawned reviews / retries within a few
 * seconds.
 */
export function useAgentRunsForStep(
  processInstanceId: string | null,
  stepId: string | null,
): { data: AgentRun[]; loading: boolean; error: Error | null } {
  const enabled = processInstanceId !== null && stepId !== null;
  const query = useQuery({
    queryKey: queryKeys.agentRuns.list(undefined, {
      runId: processInstanceId ?? undefined,
      stepId: stepId ?? undefined,
    }),
    queryFn: async () => {
      const result = await mediforce.agentRuns.list({
        runId: processInstanceId as string,
        stepId: stepId as string,
      });
      return result.runs;
    },
    enabled,
    retry: stopRetryOn4xx,
    refetchInterval: (q) => (q.state.error !== null ? false : STANDARD_LIVE_INTERVAL_MS),
  });

  return {
    data: enabled ? query.data ?? [] : [],
    loading: enabled && query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}

/**
 * Single agent-run detail. CRITICAL LIVE while non-terminal so an operator
 * watching a still-running agent sees envelope updates within ~1.5 s; polling
 * stops once the run reaches a terminal status or the query errors.
 */
export function useAgentRun(runId: string | null): {
  data: AgentRun | null;
  loading: boolean;
} {
  const query = useQuery({
    queryKey: queryKeys.agentRun(runId ?? ''),
    queryFn: async () => {
      const result = await mediforce.agentRuns.get({ agentRunId: runId as string });
      return result.run;
    },
    enabled: runId !== null,
    retry: stopRetryOn4xx,
    refetchInterval: (q) => {
      if (q.state.error !== null) return false;
      const status = q.state.data?.status;
      if (status === undefined) return CRITICAL_LIVE_INTERVAL_MS;
      return TERMINAL.has(status) ? false : CRITICAL_LIVE_INTERVAL_MS;
    },
  });

  return {
    data: runId === null ? null : query.data ?? null,
    loading: runId !== null && query.isLoading,
  };
}

/**
 * Definition-name lookup map indexed by process-instance id, scoped to the
 * active workspace `handle`. Uses the projected `mediforce.runs.listNames`
 * endpoint (issue #588): only `{ id, definitionName }` per run, not the full
 * `ProcessInstance` — the full-document `runs.list` path was ~24 s/request in
 * dev for a 10k-run workspace.
 *
 * NICE LIVE (30 s): the map only changes when a new run lands, so a slower
 * cadence plus `staleTime` cuts read volume on this loop without staleness the
 * operator would notice.
 */
export function useProcessNameMap(handle: string): Map<string, string> {
  const query = useQuery({
    queryKey: queryKeys.runs.nameMap(handle),
    enabled: handle.length > 0,
    staleTime: NICE_LIVE_INTERVAL_MS,
    queryFn: async () => {
      const result = await mediforce.runs.listNames({ namespace: handle });
      return result.runs;
    },
    refetchInterval: (q) => {
      // PRD §9 rule 4: terminate on 4xx so a session whose membership flipped
      // stops polling this slice.
      if (q.state.error !== null) return false;
      return NICE_LIVE_INTERVAL_MS;
    },
    retry: stopRetryOn4xx,
  });
  const entries = query.data ?? [];
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) map.set(entry.id, entry.definitionName);
    return map;
  }, [entries]);
}
