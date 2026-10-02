import type { EvalCaseExpectation, EvalCaseInput, EvaluatedStep, ProcessInstance } from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { ValidationError } from '../../../errors';
import { loadEvaluatedStep } from './evaluated-step';
import { loadEvaluationSubject, type EvaluationSubject } from './evaluation-subject';
import { parentCommit } from './workspace-seed';
import { HUMAN_VERDICT_SCORE_NAME } from '../../scores/record-human-verdict';

/** What an Eval Case taken from a production Agent Run starts from. */
export interface CaseSource {
  readonly step: EvaluatedStep;
  readonly subject: EvaluationSubject;
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
  const subject = await loadEvaluationSubject(scope, agentRunId, step);
  const runStep = {
    namespace: subject.instance.namespace ?? '',
    workflowName: subject.instance.definitionName,
    stepId: subject.agentRun.stepId,
  };
  await loadEvaluatedStep(scope, runStep, verb);
  if (subject.instance.evalRunId !== undefined) {
    throw new ValidationError(`Agent Run '${agentRunId}' is an eval trial, not a production run`);
  }

  const git = subject.agentRun.envelope?.gitMetadata ?? null;
  return {
    step: runStep,
    subject,
    input: caseInputOf(subject.instance, subject.stepInput),
    bareRepoPath: git?.repoUrl ?? null,
    workspaceSeedCommit: git === null ? null : await parentCommit(git.repoUrl, git.commitSha),
  };
}

/** A person's newest verdict on a run's output: approved (1) is positive, rejected (0) negative; revise and recheck (0.5) are neither. */
export async function loadVerdictExpectation(scope: CallerScope, agentRunId: string): Promise<EvalCaseExpectation | null> {
  const [verdict] = await scope.scores.list({ agentRunId, name: HUMAN_VERDICT_SCORE_NAME, limit: 1 });
  if (verdict?.value === 1) return 'positive';
  if (verdict?.value === 0) return 'negative';
  return null;
}
