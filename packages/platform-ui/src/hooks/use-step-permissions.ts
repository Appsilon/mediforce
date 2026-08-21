'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';

/**
 * Tool grants configured on a specific step, beyond its executor's default
 * set (e.g. `WebFetch`) — sourced from `mediforce.processes.getSteps`, which
 * already resolves the process instance's pinned workflow-definition
 * version server-side. Not polled: step config is fixed once a run starts,
 * so there's nothing to go live for. Shares its query key with
 * useStepExecutions, so the two hooks reuse one cached fetch per instance.
 */
export function useStepAllowedTools(
  processInstanceId: string | null,
  stepId: string | null,
): { data: string[] | undefined; loading: boolean } {
  const enabled = processInstanceId !== null && stepId !== null;

  const query = useQuery({
    queryKey: enabled ? queryKeys.processSteps(processInstanceId) : queryKeys.processSteps('__noop__'),
    queryFn: async () => {
      const result = await mediforce.processes.getSteps({ instanceId: processInstanceId as string });
      return result.steps;
    },
    enabled,
    staleTime: Infinity,
    refetchInterval: false,
    retry: stopRetryOn4xx,
  });

  const steps = query.data ?? [];
  const allowedTools = useMemo(
    () => steps.find((s) => s.stepId === stepId)?.allowedTools,
    [steps, stepId],
  );

  return { data: allowedTools, loading: enabled && query.isPending };
}
