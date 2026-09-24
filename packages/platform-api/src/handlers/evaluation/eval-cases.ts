import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { JUDGE_PASS_VALUE, type EvalCase, type EvalCaseExpectation } from '@mediforce/platform-core';
import type {
  ArchiveEvalCaseInputSchema,
  CreateEvalCaseFromAgentRunInputSchema,
  CreateEvalCaseInputSchema,
  CreateEvalCasesFromLabelsInputSchema,
  CreateEvalCasesFromLabelsOutput,
  CreatePerturbedEvalCaseInputSchema,
  EvalCaseOutput,
  ListEvalCasesInputSchema,
  ListEvalCasesOutput,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { HandlerError, NotFoundError, ValidationError } from '../../errors';
import { loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { loadCaseSource } from './_lib/case-source';
import { perturbCase } from './_lib/perturb-case';
import { commitWorkspaceChanges } from './_lib/workspace-seed';
import { evaluatorView, loadEvaluator } from './_lib/evaluator-view';
import { appendEvaluationAudit, authorId } from './_lib/audit';
import { evaluatorLabels } from './evaluator-trust';
import { HUMAN_VERDICT_SCORE_NAME } from '../scores/record-human-verdict';

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
    perturbation: null,
    origin: input.origin,
    split: input.split,
    containsProductionData: input.containsProductionData,
    archived: false,
    createdBy: authorId(scope),
    createdAt: new Date().toISOString(),
  });
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
  const source = await loadCaseSource(scope, input.agentRunId, input.step, 'edit');
  const [verdict] = await scope.scores.list({ agentRunId: input.agentRunId, name: HUMAN_VERDICT_SCORE_NAME, limit: 1 });
  const expectation = input.expectation ?? verdictExpectation(verdict?.value);
  if (expectation === undefined) {
    const why = verdict === undefined ? 'was never reviewed' : 'was sent back, neither approved nor rejected';
    throw new ValidationError(
      `Agent Run '${input.agentRunId}' ${why} — say whether it is a positive or negative case`,
    );
  }

  const { instance, agentRun } = source.subject;
  return storeCase(scope, {
    ...source.step,
    id: randomUUID(),
    name: input.name ?? `From run ${instance.id.slice(0, 8)} (${agentRun.startedAt.slice(0, 10)})`,
    input: source.input,
    workspaceSeedCommit: source.workspaceSeedCommit,
    expectation,
    notes: input.notes ?? verdict?.comment ?? null,
    source: 'production',
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
 * A case synthesized from a production Agent Run (ADR-0023 phase 2): the run's
 * input with `inputChanges` applied, starting from its workspace with
 * `fileChanges` applied as a new commit. Built from production data, so it is
 * flagged as containing it.
 */
export async function createPerturbedEvalCase(
  input: z.output<typeof CreatePerturbedEvalCaseInputSchema>,
  scope: CallerScope,
): Promise<EvalCaseOutput> {
  const step = stepRef(input);
  const source = await loadCaseSource(scope, input.baseAgentRunId, step, 'edit');
  const perturbed = await perturbCase(source, input);
  const id = randomUUID();
  let workspaceSeedCommit = source.workspaceSeedCommit;
  if (perturbed.fileContents.size > 0) {
    // perturbCase refuses file changes on a run without a workspace.
    workspaceSeedCommit = await commitWorkspaceChanges(source.bareRepoPath!, source.workspaceSeedCommit!, perturbed.fileContents, {
      message: `Eval Case '${input.name}': ${input.perturbation.kind} — ${input.perturbation.description}`,
      ref: `refs/mediforce/eval-seeds/${id}`,
    });
  }

  return storeCase(scope, {
    ...step,
    id,
    name: input.name,
    input: perturbed.input,
    workspaceSeedCommit,
    expectation: input.expectation,
    notes: input.notes,
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

/**
 * Seeds Eval Cases from an Evaluator's labels (EvalGen): every labelled
 * production output that is not already a live case from that run becomes
 * one — a pass positive, a fail negative, noting the rule and the person's
 * comment. The newest label per output decides.
 */
export async function createEvalCasesFromLabels(
  input: z.output<typeof CreateEvalCasesFromLabelsInputSchema>,
  scope: CallerScope,
): Promise<CreateEvalCasesFromLabelsOutput> {
  const evaluator = await loadEvaluator(scope, input.evaluatorId);
  const step = stepRef(evaluator);
  await loadEvaluatedStep(scope, step, 'edit');
  const { latest } = await evaluatorView(scope, evaluator);
  const existing = new Set((await scope.evaluation.listCases(step))
    .filter((evalCase) => !evalCase.archived && evalCase.source === 'production')
    .map((evalCase) => evalCase.sourceAgentRunId));

  const cases: EvalCase[] = [];
  const skipped: CreateEvalCasesFromLabelsOutput['skipped'] = [];
  for (const label of await evaluatorLabels(scope, evaluator)) {
    const agentRunId = label.subject.id;
    if (existing.has(agentRunId)) {
      skipped.push({ agentRunId, reason: 'already a case' });
      continue;
    }
    try {
      const passed = label.value >= JUDGE_PASS_VALUE;
      const verdict = `${passed ? 'Passes' : 'Fails'} '${evaluator.name}': ${latest.rule}`;
      const notes = [verdict, label.comment].filter((part) => part !== null && part !== '').join(' — ').slice(0, 4000);
      const { evalCase } = await createEvalCaseFromAgentRun({
        agentRunId,
        step,
        expectation: passed ? 'positive' : 'negative',
        notes,
        split: input.split,
        origin: 'user',
      }, scope);
      cases.push(evalCase);
      existing.add(agentRunId);
    } catch (err) {
      if (!(err instanceof HandlerError) || err.code === 'forbidden') throw err;
      skipped.push({ agentRunId, reason: err.message });
    }
  }
  return { cases, skipped };
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
