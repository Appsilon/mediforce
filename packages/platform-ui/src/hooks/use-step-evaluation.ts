'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EvaluatedStep } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';

type Section = 'brief' | 'evaluators' | 'cases' | 'datasets' | 'mcp-policy' | 'runs' | 'agent-runs';

function sectionKey(step: EvaluatedStep, section: Section) {
  return queryKeys.evaluation.section(step.namespace, step.workflowName, step.stepId, section);
}

/** Every read the Evaluation tab shows for one agent Step (ADR-0023). */
export function useStepEvaluation(step: EvaluatedStep) {
  const options = { retry: stopRetryOn4xx } as const;
  return {
    brief: useQuery({ queryKey: sectionKey(step, 'brief'), queryFn: () => mediforce.evaluation.getBrief(step), ...options }),
    evaluators: useQuery({
      queryKey: sectionKey(step, 'evaluators'),
      queryFn: () => mediforce.evaluation.listEvaluators(step),
      ...options,
    }),
    cases: useQuery({ queryKey: sectionKey(step, 'cases'), queryFn: () => mediforce.evaluation.listCases(step), ...options }),
    datasets: useQuery({ queryKey: sectionKey(step, 'datasets'), queryFn: () => mediforce.evaluation.listDatasets(step), ...options }),
    mcpPolicy: useQuery({ queryKey: sectionKey(step, 'mcp-policy'), queryFn: () => mediforce.evaluation.getMcpPolicy(step), ...options }),
    runs: useQuery({ queryKey: sectionKey(step, 'runs'), queryFn: () => mediforce.evaluation.listRuns(step), ...options }),
    agentRuns: useQuery({
      queryKey: sectionKey(step, 'agent-runs'),
      queryFn: () => mediforce.evaluation.listStepAgentRuns({ ...step, limit: 10 }),
      ...options,
    }),
  };
}

/**
 * A write on the Step's Evaluation. Every one refreshes the whole Step: an
 * accepted proposal, a frozen Dataset or a prepared run each changes what
 * more than one section shows.
 */
export function useStepEvaluationMutation<TInput, TOutput>(
  step: EvaluatedStep,
  write: (input: TInput) => Promise<TOutput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: () => queryClient.invalidateQueries({
      queryKey: queryKeys.evaluation.step(step.namespace, step.workflowName, step.stepId),
    }),
  });
}

/** One Eval Run, polled while it has trials in flight. */
export function useEvalRun(evalRunId: string | null) {
  return useQuery({
    queryKey: queryKeys.evalRun(evalRunId ?? '__none__'),
    queryFn: () => mediforce.evaluation.getRun({ evalRunId: evalRunId! }),
    enabled: evalRunId !== null,
    retry: stopRetryOn4xx,
    refetchInterval: (query) => (query.state.data?.evalRun.status === 'running' ? 3000 : false),
  });
}
