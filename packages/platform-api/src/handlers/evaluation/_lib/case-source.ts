import type { EvalCaseInput, EvaluatedStep } from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { ValidationError } from '../../../errors';
import { loadEvaluatedStep } from './evaluated-step';
import { loadEvaluationSubject, type EvaluationSubject } from './evaluation-subject';
import { parentCommit } from './workspace-seed';

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

  const variables = subject.stepInput?.steps;
  const git = subject.agentRun.envelope?.gitMetadata ?? null;
  return {
    step: runStep,
    subject,
    input: {
      triggerPayload: subject.instance.triggerPayload ?? {},
      previousStepOutputs: typeof variables === 'object' && variables !== null
        ? variables as Record<string, unknown>
        : {},
      ...(subject.instance.previousRun === undefined ? {} : { previousRun: subject.instance.previousRun }),
    },
    bareRepoPath: git?.repoUrl ?? null,
    workspaceSeedCommit: git === null ? null : await parentCommit(git.repoUrl, git.commitSha),
  };
}
