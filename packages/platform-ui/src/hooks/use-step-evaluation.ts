'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EvaluatedStep } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';

type Section =
  | 'brief'
  | 'evaluators'
  | 'cases'
  | 'datasets'
  | 'mcp-policy'
  | 'runs'
  | 'agent-runs'
  | 'criteria'
  | 'drift'
  | 'written-outputs'
  | `qualification:${number | 'runnable'}`
  | `labels:${string}`;

const STEP_AGENT_RUNS_PAGE = 20;

function sectionKey(step: EvaluatedStep, section: Section) {
  return queryKeys.evaluation.section(step.namespace, step.workflowName, step.stepId, section);
}

/** What one Agent Run's step was given and what it returned; fetched only while `agentRunId` is set. */
export function useAgentRunIo(agentRunId: string | null) {
  return useQuery({
    queryKey: queryKeys.agentRunIo(agentRunId ?? ''),
    queryFn: () => mediforce.evaluation.getAgentRunIo({ agentRunId: agentRunId! }),
    enabled: agentRunId !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: stopRetryOn4xx,
  });
}

/** The Step's live Evaluators with whether each counts. */
export function useStepEvaluators(step: EvaluatedStep) {
  return useQuery({
    queryKey: sectionKey(step, 'evaluators'),
    queryFn: () => mediforce.evaluation.listEvaluators(step),
    retry: stopRetryOn4xx,
  });
}

/** The Step's live written outputs, newest first; refreshed by every write on the Step. */
export function useWrittenOutputs(step: EvaluatedStep) {
  return useQuery({
    queryKey: sectionKey(step, 'written-outputs'),
    queryFn: () => mediforce.evaluation.listWrittenOutputs(step),
    retry: stopRetryOn4xx,
  });
}

/** The person's labels on one Evaluator's outputs; refreshed by every write on the Step. */
export function useEvaluatorLabels(step: EvaluatedStep, evaluatorId: string) {
  return useQuery({
    queryKey: sectionKey(step, `labels:${evaluatorId}`),
    queryFn: () => mediforce.evaluation.listLabels({ evaluatorId }),
    retry: stopRetryOn4xx,
  });
}

/**
 * The Step's qualification badge (ADR-0023 D11) — for its runnable version, or
 * for `definitionVersion`, what a run of that version ran.
 */
export function useStepQualification(step: EvaluatedStep, definitionVersion?: number) {
  return useQuery({
    queryKey: sectionKey(step, `qualification:${definitionVersion ?? 'runnable'}`),
    queryFn: () => mediforce.evaluation.getQualification({ ...step, ...(definitionVersion === undefined ? {} : { definitionVersion }) }),
    retry: stopRetryOn4xx,
    // The validation is read from the newest finished Eval Run; poll until a running one ends.
    refetchInterval: (query) => (query.state.data?.validation.runInProgress === true ? 5000 : false),
  });
}

/** Every read the Evaluation tab shows for one agent Step (ADR-0023). */
export function useStepEvaluation(step: EvaluatedStep) {
  const options = { retry: stopRetryOn4xx } as const;
  return {
    brief: useQuery({ queryKey: sectionKey(step, 'brief'), queryFn: () => mediforce.evaluation.getBrief(step), ...options }),
    evaluators: useStepEvaluators(step),
    cases: useQuery({ queryKey: sectionKey(step, 'cases'), queryFn: () => mediforce.evaluation.listCases(step), ...options }),
    datasets: useQuery({ queryKey: sectionKey(step, 'datasets'), queryFn: () => mediforce.evaluation.listDatasets(step), ...options }),
    mcpPolicy: useQuery({ queryKey: sectionKey(step, 'mcp-policy'), queryFn: () => mediforce.evaluation.getMcpPolicy(step), ...options }),
    runs: useQuery({ queryKey: sectionKey(step, 'runs'), queryFn: () => mediforce.evaluation.listRuns(step), ...options }),
    criteria: useQuery({ queryKey: sectionKey(step, 'criteria'), queryFn: () => mediforce.evaluation.getAcceptanceCriteria(step), ...options }),
    qualification: useStepQualification(step),
    drift: useQuery({ queryKey: sectionKey(step, 'drift'), queryFn: () => mediforce.evaluation.getDrift(step), ...options }),
    agentRuns: useInfiniteQuery({
      queryKey: sectionKey(step, 'agent-runs'),
      queryFn: ({ pageParam }) => mediforce.evaluation.listStepAgentRuns({ ...step, limit: STEP_AGENT_RUNS_PAGE, cursor: pageParam }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page) => page.nextCursor,
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

/** A running Eval Run, or a cancelled one whose trials are still running or being scored. */
function isEvalRunActive({ evalRun, trials }: { evalRun: { status: string }; trials: readonly { status: string }[] }): boolean {
  return evalRun.status === 'running'
    || trials.some((trial) => trial.status === 'running' || trial.status === 'scoring');
}

/** One Eval Run, polled while it has trials in flight. */
export function useEvalRun(evalRunId: string | null) {
  return useQuery({
    queryKey: queryKeys.evalRun(evalRunId ?? '__none__'),
    queryFn: () => mediforce.evaluation.getRun({ evalRunId: evalRunId! }),
    enabled: evalRunId !== null,
    retry: stopRetryOn4xx,
    refetchInterval: (query) => (query.state.data !== undefined && isEvalRunActive(query.state.data) ? 3000 : false),
  });
}

