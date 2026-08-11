'use client';

import { useQuery } from '@tanstack/react-query';
import type { StepExecutionStatus } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';

export interface StepSampleIo {
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  status: StepExecutionStatus | null;
  error: string | null;
  fromDryRun: boolean;
  loading: boolean;
}

/**
 * Real input/output JSON from a step's latest attempt (success or failure),
 * for the step editor's Data Flow panel. `input`/`status`/`error` reflect
 * that attempt even when it failed; `output` is null unless it completed —
 * see `getStepSampleIo` for why (dry runs, in particular, never have a real
 * output to show). All fields null/false means the step has never run.
 */
export function useStepSampleIo(
  namespace: string | undefined,
  workflowName: string | undefined,
  stepId: string,
): StepSampleIo {
  const enabled = Boolean(namespace) && Boolean(workflowName) && stepId.length > 0;

  const query = useQuery({
    queryKey: enabled
      ? queryKeys.stepSampleIo(namespace!, workflowName!, stepId)
      : queryKeys.stepSampleIo('__noop__', '__noop__', stepId),
    queryFn: () => mediforce.workflows.getStepSampleIo({
      namespace: namespace!,
      name: workflowName!,
      stepId,
    }),
    enabled,
    staleTime: 60_000,
  });

  return {
    input: query.data?.input ?? null,
    output: query.data?.output ?? null,
    status: query.data?.status ?? null,
    error: query.data?.error ?? null,
    fromDryRun: query.data?.fromDryRun ?? false,
    loading: enabled && query.isPending,
  };
}
