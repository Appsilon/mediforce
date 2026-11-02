import { z } from 'zod';
import type { AgentRun, EvalCaseLabel, EvalCaseInput, EvaluatedStep, ProcessInstance, Score } from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { ValidationError } from '../../../errors';
import { loadEvaluationSubject } from './evaluation-subject';
import { loadScoredRun, loadStepInput, runSubjectRef, type ScoredRun } from './scored-run';
import { parentCommit } from './workspace-seed';
import { HUMAN_VERDICT_SCORE_NAME } from '../../scores/record-human-verdict';

/** What an Eval Case taken from a production Agent Run starts from. */
export interface CaseSource {
  readonly step: EvaluatedStep;
  readonly subject: ScoredRun;
  /** The trigger payload and the outputs of the steps before it — the step's input before any reviewer sent it back, rebuilt. */
  readonly input: EvalCaseInput;
  /** The workflow's bare repo; null when the run had no workspace. */
  readonly bareRepoPath: string | null;
  /** The workspace the step first saw: the parent of the commit its first round produced. */
  readonly workspaceSeedCommit: string | null;
}

/** The trigger payload and the outputs of the steps before it — a run's step input as an Eval Case holds it. */
export function caseInputOf(instance: ProcessInstance, stepInput: Record<string, unknown> | null): EvalCaseInput {
  const variables = stepInput?.steps;
  return {
    triggerPayload: instance.triggerPayload ?? {},
    previousStepOutputs: typeof variables === 'object' && variables !== null
      ? variables as Record<string, unknown>
      : {},
    ...(instance.previousRun === undefined ? {} : { previousRun: instance.previousRun }),
  };
}

/** Whether a person's verdict sent a run's step back to run again. */
function sentBack(verdict: Score | undefined): boolean {
  return verdict?.label === 'revise';
}

async function newestVerdict(scope: CallerScope, agentRunId: string): Promise<Score | undefined> {
  const [verdict] = await scope.scores.list({ agentRunId, name: HUMAN_VERDICT_SCORE_NAME, limit: 1 });
  return verdict;
}

/**
 * The round a review started from: walks back from a run over the runs of its
 * step that were sent back, and past attempts that returned nothing. A run
 * before them that nobody sent back ended its own review, so what followed it
 * — a loop's next item — had an input of its own.
 */
export async function loadFirstRound(scope: CallerScope, agentRun: AgentRun): Promise<AgentRun> {
  const earlier = (await scope.agentRuns.getByInstanceId(agentRun.processInstanceId))
    .filter((run) => run.stepId === agentRun.stepId && run.startedAt < agentRun.startedAt)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  let first = agentRun;
  for (const run of earlier) {
    if (sentBack(await newestVerdict(scope, run.id))) first = run;
    else if ((run.envelope?.result ?? null) !== null) break;
  }
  return first;
}

/**
 * A production Agent Run as the source of an Eval Case (ADR-0023 D4), with the
 * caller's `verb` on its step checked. With `step`, the run must be one of it.
 * An eval trial is not a source: its input is itself a case.
 */
export async function loadCaseSource(
  scope: CallerScope,
  agentRunId: string,
  step: EvaluatedStep | undefined,
  verb: 'read' | 'edit',
): Promise<CaseSource> {
  const subject = await loadScoredRun(scope, agentRunId, step === undefined ? undefined : { ...step, kind: 'step' });
  await loadEvaluationSubject(scope, runSubjectRef(subject.agentRun, subject.instance), verb);
  if (subject.instance.evalRunId !== undefined) {
    throw new ValidationError(`Agent Run '${agentRunId}' is an eval trial, not a production run`);
  }
  const runStep = {
    namespace: subject.instance.namespace ?? '',
    workflowName: subject.instance.definitionName,
    stepId: subject.agentRun.stepId,
  };

  const firstRound = await loadFirstRound(scope, subject.agentRun);
  const git = firstRound.envelope?.gitMetadata ?? null;
  return {
    step: runStep,
    subject,
    input: caseInputOf(subject.instance, await loadStepInput(scope, firstRound, subject.instance)),
    bareRepoPath: git?.repoUrl ?? null,
    workspaceSeedCommit: git === null ? null : await parentCommit(git.repoUrl, git.commitSha),
  };
}

/** What a person's review makes of a run's output as an Eval Case. */
export type VerdictLabel = Pick<EvalCaseLabel, 'expectation' | 'comparison' | 'agreementInstructions'>;

const AGREEMENT_INSTRUCTIONS_MAX_CHARS = 4000;

const VerdictParamsSchema = z.object({ paramValues: z.record(z.string(), z.unknown()) });

function reviseInstructions(verdict: Score): string | null {
  const request = verdict.comment?.trim() ?? '';
  const params = VerdictParamsSchema.safeParse(verdict.metadata);
  const paramValues = params.success ? params.data.paramValues : {};
  const feedback = [
    ...(request === '' ? [] : [`Reviewer's request: ${request}`]),
    ...(Object.keys(paramValues).length === 0 ? [] : [`Values the reviewer set: ${JSON.stringify(paramValues)}`]),
  ];
  if (feedback.length === 0) return null;
  return [
    'The reviewer sent this output back and asked for a change. An output that still needs the change agrees with this one; an output that makes it does not.',
    ...feedback,
  ].join('\n\n').slice(0, AGREEMENT_INSTRUCTIONS_MAX_CHARS);
}

/**
 * A person's newest verdict on a run's output: approved (1) is positive and
 * rejected (0) negative, compared exactly; `revise` is negative, compared by
 * meaning on the reviewer's comment and param values, since a re-run never
 * equals the discarded output word for word. Any other verdict, a recheck,
 * labels nothing.
 */
export async function loadVerdictLabel(scope: CallerScope, agentRunId: string): Promise<VerdictLabel | null> {
  const verdict = await newestVerdict(scope, agentRunId);
  if (verdict === undefined) return null;
  if (sentBack(verdict)) return { expectation: 'negative', comparison: 'agreement', agreementInstructions: reviseInstructions(verdict) };
  if (verdict.value === 1) return { expectation: 'positive', comparison: 'exact', agreementInstructions: null };
  if (verdict.value === 0) return { expectation: 'negative', comparison: 'exact', agreementInstructions: null };
  return null;
}
