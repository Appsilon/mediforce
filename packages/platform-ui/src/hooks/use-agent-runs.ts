'use client';

import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
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

/** Where a run lives and what it is called — everything a row needs to link. */
export interface RunLocation {
  readonly definitionName: string;
  readonly namespace: string;
}

/**
 * Run lookup indexed by process-instance id, covering every workspace in
 * `handles`. Uses the projected `mediforce.runs.listNames` endpoint (issue
 * #588): only `{ id, definitionName }` per run, not the full
 * `ProcessInstance` — the full-document `runs.list` path was ~24 s/request in
 * dev for a 10k-run workspace.
 *
 * One query per workspace rather than one widened endpoint: the entries are
 * already keyed and cached per workspace, so a selection that adds a workspace
 * re-uses every map it already had and fetches only the new one. The endpoint
 * answers per workspace, which is also how `namespace` re-enters the result —
 * `RunNameEntry` itself does not carry one, and a row rendered under a
 * multi-workspace selection needs it to build a link that resolves.
 *
 * NICE LIVE (30 s): the map only changes when a new run lands, so a slower
 * cadence plus `staleTime` cuts read volume on this loop without staleness the
 * operator would notice.
 */
export function useProcessRunMap(handles: readonly string[]): Map<string, RunLocation> {
  const namespaces = useMemo(
    () => [...new Set(handles.filter((handle) => handle.length > 0))].sort(),
    [handles],
  );

  const results = useQueries({
    queries: namespaces.map((namespace) => ({
      queryKey: queryKeys.runs.nameMap(namespace),
      staleTime: NICE_LIVE_INTERVAL_MS,
      queryFn: async () => {
        const result = await mediforce.runs.listNames({ namespace });
        return result.runs.map((run) => ({ ...run, namespace }));
      },
      refetchInterval: (q: { state: { error: unknown } }) => {
        // PRD §9 rule 4: terminate on 4xx so a session whose membership
        // flipped stops polling this slice.
        if (q.state.error !== null) return false as const;
        return NICE_LIVE_INTERVAL_MS;
      },
      retry: stopRetryOn4xx,
    })),
  });

  // `useQueries` returns a fresh array every render, so the map is memoised on
  // the entry payloads rather than on `results` itself.
  const entries = results.flatMap((result) => result.data ?? []);
  const fingerprint = entries.map((entry) => `${entry.namespace}/${entry.id}`).join(',');

  return useMemo(() => {
    const map = new Map<string, RunLocation>();
    for (const entry of entries) {
      map.set(entry.id, { definitionName: entry.definitionName, namespace: entry.namespace });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);
}

/**
 * Single-workspace definition-name map — the shape the monitoring tabs read.
 * A projection of `useProcessRunMap`, so both share one cache entry per
 * workspace.
 */
export function useProcessNameMap(handle: string): Map<string, string> {
  const runs = useProcessRunMap(useMemo(() => [handle], [handle]));
  return useMemo(
    () => new Map([...runs].map(([id, run]) => [id, run.definitionName])),
    [runs],
  );
}
