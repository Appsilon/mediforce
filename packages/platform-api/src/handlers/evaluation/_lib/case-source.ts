import type { EvalCaseLabel, EvalCaseInput, EvaluatedStep, ProcessInstance } from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { ValidationError } from '../../../errors';
import { loadEvaluationSubject } from './evaluation-subject';
import { loadScoredRun, runSubjectRef, type ScoredRun } from './scored-run';
import { parentCommit } from './workspace-seed';
import { HUMAN_VERDICT_SCORE_NAME } from '../../scores/record-human-verdict';

/** What an Eval Case taken from a production Agent Run starts from. */
export interface CaseSource {
  readonly step: EvaluatedStep;
  readonly subject: ScoredRun;
  /** The trigger payload and the outputs of the steps before it — the step's input, rebuilt. */
  readonly input: EvalCaseInput;
  /** The workflow's bare repo; null when the run had no workspace. */
  readonly bareRepoPath: string | null;
  /** The workspace the step saw: the parent of the commit it produced. */
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

  const git = subject.agentRun.envelope?.gitMetadata ?? null;
  return {
    step: runStep,
    subject,
    input: caseInputOf(subject.instance, subject.stepInput),
    bareRepoPath: git?.repoUrl ?? null,
    workspaceSeedCommit: git === null ? null : await parentCommit(git.repoUrl, git.commitSha),
  };
}

/** What a person's review makes of a run's output as an Eval Case. */
export type VerdictLabel = Pick<EvalCaseLabel, 'expectation' | 'comparison' | 'agreementInstructions'>;

const AGREEMENT_INSTRUCTIONS_MAX_CHARS = 4000;

function reviseInstructions(comment: string | null | undefined): string | null {
  const request = comment?.trim() ?? '';
  if (request === '') return null;
  return `The reviewer sent this output back and asked for a change. An output that still needs the change agrees with this one; an output that makes it does not.\n\nReviewer's request: ${request}`.slice(0, AGREEMENT_INSTRUCTIONS_MAX_CHARS);
}

/**
 * A person's newest verdict on a run's output: approved (1) is positive and
 * rejected (0) negative, compared exactly; `revise` is negative, compared by
 * meaning on the reviewer's comment, since a re-run never equals the discarded
 * output word for word. Any other verdict, a recheck, labels nothing.
 */
export async function loadVerdictLabel(scope: CallerScope, agentRunId: string): Promise<VerdictLabel | null> {
  const [verdict] = await scope.scores.list({ agentRunId, name: HUMAN_VERDICT_SCORE_NAME, limit: 1 });
  if (verdict?.label === 'revise') return { expectation: 'negative', comparison: 'agreement', agreementInstructions: reviseInstructions(verdict.comment) };
  if (verdict?.value === 1) return { expectation: 'positive', comparison: 'exact', agreementInstructions: null };
  if (verdict?.value === 0) return { expectation: 'negative', comparison: 'exact', agreementInstructions: null };
  return null;
}
