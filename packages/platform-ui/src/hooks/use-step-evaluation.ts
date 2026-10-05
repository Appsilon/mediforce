'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EvaluatedStep } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';

type Section =
  | 'brief'
  | 'evaluators'
  | 'evaluators-with-archived'
  | 'cases'
  | 'datasets'
  | 'runs'
  | 'agent-runs'
  | 'criteria'
  | 'drift'
  | `qualification:${number | 'runnable'}`
  | `estimate:${number}:${number}`;

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

/**
 * Every Evaluator the Step ever had, archived ones too, with all their
 * versions — what an Eval Run froze may since have been archived.
 */
export function useStepEvaluatorHistory(step: EvaluatedStep) {
  return useQuery({
    queryKey: sectionKey(step, 'evaluators-with-archived'),
    queryFn: () => mediforce.evaluation.listEvaluators({ ...step, includeArchived: 'true' }),
    retry: stopRetryOn4xx,
  });
}

/** The Step's frozen Dataset versions, newest first. */
export function useStepDatasets(step: EvaluatedStep) {
  return useQuery({ queryKey: sectionKey(step, 'datasets'), queryFn: () => mediforce.evaluation.listDatasets(step), retry: stopRetryOn4xx });
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

/**
 * Whether each version of the workflow is verified, one agent step at a time —
 * polled while an Eval Run of any step is running.
 */
export function useWorkflowValidation(namespace: string, workflowName: string) {
  return useQuery({
    queryKey: queryKeys.workflowValidation(namespace, workflowName),
    queryFn: () => mediforce.evaluation.getWorkflowValidation({ namespace, workflowName }),
    retry: stopRetryOn4xx,
    refetchInterval: (query) => (
      query.state.data?.versions.some((version) => version.steps.some((step) => step.validation.runInProgress)) === true ? 5000 : false
    ),
  });
}

/**
 * What an Eval Run of `definitionVersion` would cost at `trialsPerCase` — off
 * while the trial count is not valid; the last estimate stays shown while the
 * next one loads.
 */
export function useEvalRunEstimate(step: EvaluatedStep, definitionVersion: number, trialsPerCase: number | null) {
  return useQuery({
    queryKey: sectionKey(step, `estimate:${definitionVersion}:${trialsPerCase ?? 0}`),
    queryFn: () => mediforce.evaluation.estimateRun({ ...step, definitionVersion, trialsPerCase: trialsPerCase! }),
    enabled: trialsPerCase !== null,
    placeholderData: keepPreviousData,
    retry: stopRetryOn4xx,
  });
}

/** Every read the Evaluation tab shows for one agent Step (ADR-0023), its validation in `definitionVersion`. */
export function useStepEvaluation(step: EvaluatedStep, definitionVersion: number) {
  const options = { retry: stopRetryOn4xx } as const;
  return {
    brief: useQuery({ queryKey: sectionKey(step, 'brief'), queryFn: () => mediforce.evaluation.getBrief(step), ...options }),
    evaluators: useStepEvaluators(step),
    cases: useQuery({ queryKey: sectionKey(step, 'cases'), queryFn: () => mediforce.evaluation.listCases(step), ...options }),
    datasets: useStepDatasets(step),
    runs: useQuery({ queryKey: sectionKey(step, 'runs'), queryFn: () => mediforce.evaluation.listRuns(step), ...options }),
    criteria: useQuery({ queryKey: sectionKey(step, 'criteria'), queryFn: () => mediforce.evaluation.getAcceptanceCriteria(step), ...options }),
    qualification: useStepQualification(step, definitionVersion),
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
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.evaluation.step(step.namespace, step.workflowName, step.stepId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.workflowValidation(step.namespace, step.workflowName) }),
    ]),
  });
}

/** A write that changes one Eval Run's report: refreshes the run, and the Step's sections its validation shows in. */
export function useEvalRunMutation<TInput, TOutput>(
  step: EvaluatedStep,
  evalRunId: string,
  write: (input: TInput) => Promise<TOutput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.evalRun(evalRunId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.evaluation.step(step.namespace, step.workflowName, step.stepId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.workflowValidation(step.namespace, step.workflowName) }),
    ]),
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

/**
 * One trial of an Eval Run with everything its Evaluators read and gave,
 * polled until it is scored. Under the run's key, so a review of one of its
 * verdicts refreshes it.
 */
export function useEvalTrial(evalRunId: string, trialId: string) {
  return useQuery({
    queryKey: queryKeys.evalTrial(evalRunId, trialId),
    queryFn: () => mediforce.evaluation.getTrial({ evalRunId, trialId }),
    retry: stopRetryOn4xx,
    refetchInterval: (query) => {
      const status = query.state.data?.trial.status;
      return status === 'pending' || status === 'running' || status === 'scoring' ? 3000 : false;
    },
  });
}
