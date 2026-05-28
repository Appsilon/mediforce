'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AgentRun, AgentRunStatus, ProcessInstance } from '@mediforce/platform-core';
import { ApiError, mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { useCollection } from './use-collection';

const STANDARD_LIVE_INTERVAL_MS = 5_000;
const CRITICAL_LIVE_INTERVAL_MS = 1_500;
const TERMINAL: ReadonlySet<AgentRunStatus> = new Set([
  'completed',
  'timed_out',
  'low_confidence',
  'error',
  'escalated',
  'flagged',
]);

// ADR-0006 §8a — 4xx is not transient; stop retrying so a 403/404 surfaces
// immediately instead of burning the default two retries first.
function stopRetryOn4xx(failureCount: number, err: unknown): boolean {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
  return failureCount < 2;
}

/**
 * Practical cap for the unbounded UI fetch. Pre-PR2 the page used a Firestore
 * subscription with no limit at all; matching that UX with HTTP needs a
 * single bounded request — auto-paginate would surface staggered counts and
 * complicates the workspace-wide JS-side filters on Run History.
 *
 * Tracked: a real keyset + server-side filter pass is scoped for after the
 * Postgres migration (ADR-0001), where keyset offsets are native. Until
 * then this cap is the explicit ceiling — operators who genuinely need
 * more reach for `mediforce agent-run list --cursor` from the CLI, which
 * still walks the paginated API.
 */
const AGENT_RUNS_UI_LIMIT = 10_000;

/**
 * List agent runs scoped to a workspace via `mediforce.agentRuns.list`.
 * STANDARD LIVE per ADR-0006 §4 — polls every 5 s for fresh runs.
 *
 * `handle` is required: a missing namespace filter would give system-actor
 * callers (CLI / agent runtime) a cross-workspace firehose, and there is no
 * legitimate UI surface that wants every run across every workspace.
 */
export function useAgentRuns(handle: string): {
  data: AgentRun[];
  loading: boolean;
  error: Error | null;
} {
  const query = useQuery({
    queryKey: queryKeys.agentRuns.list(handle),
    queryFn: async () => {
      const result = await mediforce.agentRuns.list({
        namespace: handle,
        limit: AGENT_RUNS_UI_LIMIT,
      });
      return result.runs;
    },
    enabled: handle.length > 0,
    retry: stopRetryOn4xx,
    refetchInterval: (q) => (q.state.error !== null ? false : STANDARD_LIVE_INTERVAL_MS),
  });

  return {
    data: query.data ?? [],
    loading: handle.length > 0 && query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}

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
 * @deprecated Firestore-backed `processInstances` subscription kept here so
 * the agents list page can render definition-name labels until the
 * processes-domain react-query migration lands.
 */
export function useProcessNameMap(): Map<string, string> {
  const { data: instances } = useCollection<ProcessInstance>('processInstances');
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const inst of instances) map.set(inst.id, inst.definitionName);
    return map;
  }, [instances]);
}
