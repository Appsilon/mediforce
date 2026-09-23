import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { z } from 'zod';
import type { EvalCase, EvalCaseExpectation } from '@mediforce/platform-core';
import type {
  ArchiveEvalCaseInputSchema,
  CreateEvalCaseFromAgentRunInputSchema,
  CreateEvalCaseInputSchema,
  EvalCaseOutput,
  ListEvalCasesInputSchema,
  ListEvalCasesOutput,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { NotFoundError, ValidationError } from '../../errors';
import { loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { loadEvaluationSubject } from './_lib/evaluation-subject';
import { appendEvaluationAudit, authorId } from './_lib/audit';
import { HUMAN_VERDICT_SCORE_NAME } from '../scores/record-human-verdict';

const execFileAsync = promisify(execFile);

export async function listEvalCases(
  input: z.output<typeof ListEvalCasesInputSchema>,
  scope: CallerScope,
): Promise<ListEvalCasesOutput> {
  await loadEvaluatedStep(scope, input, 'read');
  const cases = await scope.evaluation.listCases(stepRef(input));
  return { cases: input.includeArchived === true ? cases : cases.filter((evalCase) => !evalCase.archived) };
}

async function storeCase(scope: CallerScope, evalCase: EvalCase): Promise<EvalCaseOutput> {
  const stored = await scope.evaluation.createCase(evalCase);
  await appendEvaluationAudit(scope, {
    action: 'eval_case.created',
    description: `Eval Case '${stored.name}' (${stored.source}, ${stored.expectation}) added to step '${stored.stepId}'`,
    namespace: stored.namespace,
    entityType: 'eval_case',
    entityId: stored.id,
    inputSnapshot: {
      workflowName: stored.workflowName,
      stepId: stored.stepId,
      source: stored.source,
      sourceAgentRunId: stored.sourceAgentRunId,
      expectation: stored.expectation,
      split: stored.split,
      containsProductionData: stored.containsProductionData,
    },
    basis: 'Eval Case added to the Step\'s evaluation set (ADR-0023 D2)',
  });
  return { evalCase: stored };
}

/** A hand-written Eval Case. */
export async function createEvalCase(
  input: z.output<typeof CreateEvalCaseInputSchema>,
  scope: CallerScope,
): Promise<EvalCaseOutput> {
  const step = stepRef(input);
  await loadEvaluatedStep(scope, step, 'edit');
  return storeCase(scope, {
    ...step,
    id: randomUUID(),
    name: input.name,
    input: input.input,
    workspaceSeedCommit: input.workspaceSeedCommit,
    expectation: input.expectation,
    notes: input.notes,
    source: 'manual',
    sourceAgentRunId: null,
    split: input.split,
    containsProductionData: input.containsProductionData,
    archived: false,
    createdBy: authorId(scope),
    createdAt: new Date().toISOString(),
  });
}

/** The workspace a step saw: the parent of the commit it produced on the run branch. */
async function parentCommit(bareRepoPath: string, commitSha: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['--git-dir', bareRepoPath, 'rev-parse', `${commitSha}^`]);
    return stdout.trim();
  } catch {
    // The first commit of a run branch has a parent; a missing repo or commit
    // means the workspace is gone, and the case starts from an empty one.
    return null;
  }
}

/** Approved (1) is positive, rejected (0) negative; revise and recheck (0.5) are neither. */
function verdictExpectation(value: number | undefined): EvalCaseExpectation | undefined {
  if (value === 1) return 'positive';
  if (value === 0) return 'negative';
  return undefined;
}

/**
 * "Add to eval set" from a production Agent Run (ADR-0023 D4): the trigger
 * payload and the outputs of the steps before it rebuild the step's input,
 * and the parent of the commit it produced is the workspace it saw. An
 * approved run is a positive case; a rejected one is negative, carrying the
 * reviewer's comment as what the output must not do. A run sent back for
 * revision or a recheck says neither, so the caller must.
 */
export async function createEvalCaseFromAgentRun(
  input: z.output<typeof CreateEvalCaseFromAgentRunInputSchema>,
  scope: CallerScope,
): Promise<EvalCaseOutput> {
  const subject = await loadEvaluationSubject(scope, input.agentRunId);
  const step = {
    namespace: subject.instance.namespace ?? '',
    workflowName: subject.instance.definitionName,
    stepId: subject.agentRun.stepId,
  };
  await loadEvaluatedStep(scope, step, 'edit');

  const [verdict] = await scope.scores.list({ agentRunId: input.agentRunId, name: HUMAN_VERDICT_SCORE_NAME, limit: 1 });
  const expectation = input.expectation ?? verdictExpectation(verdict?.value);
  if (expectation === undefined) {
    const why = verdict === undefined ? 'was never reviewed' : 'was sent back, neither approved nor rejected';
    throw new ValidationError(
      `Agent Run '${input.agentRunId}' ${why} — say whether it is a positive or negative case`,
    );
  }

  const variables = subject.stepInput?.steps;
  const git = subject.agentRun.envelope?.gitMetadata ?? null;
  return storeCase(scope, {
    ...step,
    id: randomUUID(),
    name: input.name ?? `From run ${subject.instance.id.slice(0, 8)} (${subject.agentRun.startedAt.slice(0, 10)})`,
    input: {
      triggerPayload: subject.instance.triggerPayload ?? {},
      previousStepOutputs: typeof variables === 'object' && variables !== null
        ? variables as Record<string, unknown>
        : {},
      ...(subject.instance.previousRun === undefined ? {} : { previousRun: subject.instance.previousRun }),
    },
    workspaceSeedCommit: git === null ? null : await parentCommit(git.repoUrl, git.commitSha),
    expectation,
    notes: input.notes ?? verdict?.comment ?? null,
    source: 'production',
    sourceAgentRunId: input.agentRunId,
    split: input.split,
    containsProductionData: true,
    archived: false,
    createdBy: authorId(scope),
    createdAt: new Date().toISOString(),
  });
}

export async function archiveEvalCase(
  input: z.output<typeof ArchiveEvalCaseInputSchema>,
  scope: CallerScope,
): Promise<EvalCaseOutput> {
  const evalCase = await scope.evaluation.getCase(input.caseId);
  if (evalCase === null) throw new NotFoundError(`Eval Case '${input.caseId}' not found`);
  await loadEvaluatedStep(scope, stepRef(evalCase), 'edit');
  await scope.evaluation.setCaseArchived(evalCase, input.archived);
  await appendEvaluationAudit(scope, {
    action: input.archived ? 'eval_case.archived' : 'eval_case.restored',
    description: `Eval Case '${evalCase.name}' ${input.archived ? 'archived' : 'restored'}`,
    namespace: evalCase.namespace,
    entityType: 'eval_case',
    entityId: evalCase.id,
    inputSnapshot: { archived: input.archived },
    basis: 'An archived case is left out of new Dataset versions; frozen versions keep it',
  });
  return { evalCase: { ...evalCase, archived: input.archived } };
}
