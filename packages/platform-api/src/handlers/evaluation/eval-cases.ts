import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { z } from 'zod';
import type { EvalCase, EvalCaseLabel, EvaluatedStep } from '@mediforce/platform-core';
import type {
  ArchiveEvalCaseInputSchema,
  CreateEvalCaseFromAgentRunInputSchema,
  CreateEvalCaseInputSchema,
  CreatePerturbedEvalCaseInputSchema,
  EvalCaseOutput,
  ListEvalCasesInputSchema,
  ListEvalCasesOutput,
  UpdateEvalCaseInputSchema,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { NotFoundError, ValidationError } from '../../errors';
import { loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { loadCaseSource, loadVerdictExpectation } from './_lib/case-source';
import { perturbCase } from './_lib/perturb-case';
import { commitWorkspaceChanges } from './_lib/workspace-seed';
import { appendEvaluationAudit, authorId } from './_lib/audit';

export async function listEvalCases(
  input: z.output<typeof ListEvalCasesInputSchema>,
  scope: CallerScope,
): Promise<ListEvalCasesOutput> {
  await loadEvaluatedStep(scope, input, 'read');
  const cases = await scope.evaluation.listCases(stepRef(input));
  return { cases: input.includeArchived === true ? cases : cases.filter((evalCase) => !evalCase.archived) };
}

/** A case selects only live Evaluators of its own step: an archived one is in no Eval Run, so it would grade nothing. */
async function checkSelectedEvaluators(scope: CallerScope, step: EvaluatedStep, evaluatorIds: readonly string[] | null): Promise<void> {
  if (evaluatorIds === null) return;
  const own = new Set((await scope.evaluation.listEvaluators(step)).filter((evaluator) => evaluator.archived === false).map((evaluator) => evaluator.id));
  const foreign = evaluatorIds.filter((evaluatorId) => own.has(evaluatorId) === false);
  if (foreign.length > 0) throw new ValidationError(`Step '${step.stepId}' has no live Evaluator ${foreign.map((evaluatorId) => `'${evaluatorId}'`).join(', ')}`);
}

function labelOf(input: EvalCaseLabel): EvalCaseLabel {
  return {
    expectedOutput: input.expectedOutput,
    expectation: input.expectation,
    comparison: input.comparison,
    agreementInstructions: input.agreementInstructions,
    evaluatorIds: input.evaluatorIds,
  };
}

async function storeCase(scope: CallerScope, evalCase: EvalCase): Promise<EvalCaseOutput> {
  await checkSelectedEvaluators(scope, stepRef(evalCase), evalCase.evaluatorIds);
  const stored = await scope.evaluation.createCase(evalCase);
  await appendEvaluationAudit(scope, {
    action: 'eval_case.created',
    description: `Eval Case '${stored.name}' (${stored.source}, ${stored.expectation}) added to step '${stored.stepId}'${stored.origin === 'assistant' ? ' from an Evaluation Assistant proposal' : ''}`,
    namespace: stored.namespace,
    entityType: 'eval_case',
    entityId: stored.id,
    inputSnapshot: {
      workflowName: stored.workflowName,
      stepId: stored.stepId,
      source: stored.source,
      sourceAgentRunId: stored.sourceAgentRunId,
      perturbation: stored.perturbation,
      origin: stored.origin,
      expectation: stored.expectation,
      hasExpectedOutput: stored.expectedOutput !== null,
      comparison: stored.comparison,
      evaluatorIds: stored.evaluatorIds,
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
    ...labelOf(input),
    source: 'manual',
    sourceAgentRunId: null,
    perturbation: null,
    origin: input.origin,
    split: input.split,
    containsProductionData: input.containsProductionData,
    archived: false,
    createdBy: authorId(scope),
    createdAt: new Date().toISOString(),
  });
}

/**
 * "Add to eval set" from a production Agent Run (ADR-0023 D4): the trigger
 * payload and the outputs of the steps before it rebuild the step's input,
 * and the parent of the commit it produced is the workspace it saw. An
 * approved run's output is the case's expected output, to match; a rejected
 * run's is one to avoid. A run sent back for revision or a recheck, or never
 * reviewed, gives no expected output unless the caller gives one. An input
 * other than the run's is one production never saw: the case is manual, and
 * keeps the run it came from.
 */
export async function createEvalCaseFromAgentRun(
  input: z.output<typeof CreateEvalCaseFromAgentRunInputSchema>,
  scope: CallerScope,
): Promise<EvalCaseOutput> {
  const source = await loadCaseSource(scope, input.agentRunId, input.step, 'edit');
  const verdictLabel = await loadVerdictExpectation(scope, input.agentRunId);
  const { instance, agentRun } = source.subject;
  // The verdict labels the run's own output; an expected output the caller gives (null included) is one to match unless it says otherwise.
  const fromRun = input.expectedOutput === undefined;
  const expectedOutput = fromRun ? (verdictLabel === null ? null : agentRun.envelope?.result ?? null) : input.expectedOutput;
  const caseInput = input.input ?? source.input;
  return storeCase(scope, {
    ...source.step,
    id: randomUUID(),
    name: input.name ?? `From run ${instance.id.slice(0, 8)} (${agentRun.startedAt.slice(0, 10)})`,
    input: caseInput,
    workspaceSeedCommit: source.workspaceSeedCommit,
    ...labelOf({ ...input, expectedOutput, expectation: input.expectation ?? (fromRun ? verdictLabel : null) ?? 'positive' }),
    source: isDeepStrictEqual(caseInput, source.input) ? 'production' : 'manual',
    sourceAgentRunId: input.agentRunId,
    perturbation: null,
    origin: input.origin,
    split: input.split,
    containsProductionData: true,
    archived: false,
    createdBy: authorId(scope),
    createdAt: new Date().toISOString(),
  });
}

/**
 * A case synthesized from a production Agent Run: the run's input with
 * `inputChanges` applied, starting from its workspace with `fileChanges`
 * applied as a new commit. Built from production data, so it is flagged as
 * containing it.
 */
export async function createPerturbedEvalCase(
  input: z.output<typeof CreatePerturbedEvalCaseInputSchema>,
  scope: CallerScope,
): Promise<EvalCaseOutput> {
  const step = stepRef(input);
  await loadEvaluatedStep(scope, step, 'edit');
  const source = await loadCaseSource(scope, input.baseAgentRunId, step, 'edit');
  const perturbed = await perturbCase(source, input);
  const id = randomUUID();
  const { workspaceChange } = perturbed;
  const workspaceSeedCommit = workspaceChange === null
    ? source.workspaceSeedCommit
    : await commitWorkspaceChanges(workspaceChange.bareRepoPath, workspaceChange.baseCommit, workspaceChange.contents, {
      message: `Eval Case '${input.name}': ${input.perturbation.kind} — ${input.perturbation.description}`,
      ref: `refs/mediforce/eval-seeds/${id}`,
    });

  return storeCase(scope, {
    ...step,
    id,
    name: input.name,
    input: perturbed.input,
    workspaceSeedCommit,
    ...labelOf(input),
    source: 'synthesized',
    sourceAgentRunId: input.baseAgentRunId,
    perturbation: input.perturbation,
    origin: input.origin,
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

/**
 * Edits an Eval Case as a replacement: a new case with the changes, and the
 * old one archived — a Dataset version frozen with it keeps exactly what it
 * ran. A production case whose input is edited becomes a manual one, since
 * production never saw that input; it keeps the run it came from.
 */
export async function updateEvalCase(
  input: z.output<typeof UpdateEvalCaseInputSchema>,
  scope: CallerScope,
): Promise<EvalCaseOutput> {
  const evalCase = await scope.evaluation.getCase(input.caseId);
  if (evalCase === null) throw new NotFoundError(`Eval Case '${input.caseId}' not found`);
  await loadEvaluatedStep(scope, stepRef(evalCase), 'edit');
  if (evalCase.archived) throw new ValidationError(`Eval Case '${evalCase.name}' is archived — restore it before editing it`);

  const { caseId: _caseId, ...changes } = input;
  const changed = (Object.keys(changes) as Array<keyof typeof changes>)
    .filter((field) => changes[field] !== undefined && JSON.stringify(changes[field]) !== JSON.stringify(evalCase[field]));
  if (changed.length === 0) throw new ValidationError(`The edit changes nothing in Eval Case '${evalCase.name}'`);

  if (changed.includes('evaluatorIds')) await checkSelectedEvaluators(scope, stepRef(evalCase), changes.evaluatorIds ?? null);
  const inputEdited = changed.includes('input');
  const stored = await scope.evaluation.createCase({
    ...evalCase,
    ...Object.fromEntries(changed.map((field) => [field, changes[field]])),
    id: randomUUID(),
    source: inputEdited && evalCase.source === 'production' ? 'manual' : evalCase.source,
    createdBy: authorId(scope),
    createdAt: new Date().toISOString(),
  });
  await scope.evaluation.setCaseArchived(evalCase, true);
  await appendEvaluationAudit(scope, {
    action: 'eval_case.edited',
    description: `Eval Case '${stored.name}' edited (${changed.join(', ')}); it replaces the case '${evalCase.name}', now archived`,
    namespace: stored.namespace,
    entityType: 'eval_case',
    entityId: stored.id,
    inputSnapshot: { replaces: evalCase.id, changed, ...Object.fromEntries(changed.map((field) => [field, stored[field]])) },
    basis: 'An Eval Case edit is a new case; frozen Dataset versions keep the case they froze (ADR-0023)',
  });
  return { evalCase: stored };
}
