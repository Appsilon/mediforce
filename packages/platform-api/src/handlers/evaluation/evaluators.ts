import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  AddEvaluatorVersionInputSchema,
  ArchiveEvaluatorInputSchema,
  CreateEvaluatorInputSchema,
  EvaluatorOutput,
  GetEvaluatorInput,
  ListEvaluatorsInputSchema,
  ListEvaluatorsOutput,
  SetEvaluatorProductionInput,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { ConflictError } from '../../errors';
import { loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { evaluatorView, loadEvaluator } from './_lib/evaluator-view';
import { appendEvaluationAudit, authorId } from './_lib/audit';

export async function listEvaluators(
  input: z.output<typeof ListEvaluatorsInputSchema>,
  scope: CallerScope,
): Promise<ListEvaluatorsOutput> {
  await loadEvaluatedStep(scope, input, 'read');
  const evaluators = await scope.evaluation.listEvaluators(stepRef(input));
  const shown = input.includeArchived === true ? evaluators : evaluators.filter((evaluator) => !evaluator.archived);
  return { evaluators: await Promise.all(shown.map((evaluator) => evaluatorView(scope, evaluator))) };
}

export async function getEvaluator(input: GetEvaluatorInput, scope: CallerScope): Promise<EvaluatorOutput> {
  return { evaluator: await evaluatorView(scope, await loadEvaluator(scope, input.evaluatorId)) };
}

/** An Evaluator starts at version 1. A `schema` check counts at once; the others wait for the trust gate (D9). */
export async function createEvaluator(
  input: z.output<typeof CreateEvaluatorInputSchema>,
  scope: CallerScope,
): Promise<EvaluatorOutput> {
  const step = stepRef(input);
  await loadEvaluatedStep(scope, step, 'edit');
  const existing = await scope.evaluation.listEvaluators(step);
  if (existing.some((evaluator) => evaluator.name === input.name)) {
    throw new ConflictError(`Step '${step.stepId}' already has an Evaluator named '${input.name}'`);
  }

  const now = new Date().toISOString();
  const createdBy = authorId(scope);
  const runInProduction = input.runInProduction ?? false;
  const evaluator = {
    ...step,
    id: randomUUID(),
    name: input.name,
    archived: false,
    runInProduction,
    createdBy,
    createdAt: now,
  };
  await scope.evaluation.createEvaluator(evaluator, {
    evaluatorId: evaluator.id,
    version: 1,
    rule: input.rule,
    severity: input.severity,
    check: input.check,
    origin: input.origin,
    sourceApproval: null,
    calibration: null,
    createdBy,
    createdAt: now,
  });
  await appendEvaluationAudit(scope, {
    action: 'evaluator.created',
    description: `Evaluator '${input.name}' (${input.check.kind}, ${input.severity}) created for step '${step.stepId}'`,
    namespace: step.namespace,
    entityType: 'evaluator',
    entityId: evaluator.id,
    inputSnapshot: {
      ...step,
      name: input.name,
      rule: input.rule,
      severity: input.severity,
      check: input.check,
      origin: input.origin,
      runInProduction,
    },
    outputSnapshot: { version: 1 },
    basis: 'Evaluator added to a Step (ADR-0023 D2)',
  });
  return { evaluator: await evaluatorView(scope, evaluator) };
}

/**
 * A change to an Evaluator is a new version (D7): the ones before it keep
 * meaning what they meant for the Scores they produced. Approval and
 * calibration belong to a version, so a new version starts without them.
 */
export async function addEvaluatorVersion(
  input: z.output<typeof AddEvaluatorVersionInputSchema>,
  scope: CallerScope,
): Promise<EvaluatorOutput> {
  const evaluator = await loadEvaluator(scope, input.evaluatorId);
  await loadEvaluatedStep(scope, stepRef(evaluator), 'edit');
  const { latest } = await evaluatorView(scope, evaluator);
  const version = await scope.evaluation.appendEvaluatorVersion(evaluator, {
    evaluatorId: evaluator.id,
    version: latest.version + 1,
    rule: input.rule ?? latest.rule,
    severity: input.severity ?? latest.severity,
    check: input.check ?? latest.check,
    origin: input.origin,
    sourceApproval: null,
    calibration: null,
    createdBy: authorId(scope),
    createdAt: new Date().toISOString(),
  });
  await appendEvaluationAudit(scope, {
    action: 'evaluator.version_created',
    description: `Evaluator '${evaluator.name}' v${version.version} created`,
    namespace: evaluator.namespace,
    entityType: 'evaluator',
    entityId: evaluator.id,
    inputSnapshot: { rule: version.rule, severity: version.severity, check: version.check, origin: version.origin },
    outputSnapshot: { version: version.version, previousVersion: latest.version },
    basis: 'An Evaluator change is a new immutable version (ADR-0023 D7)',
  });
  return { evaluator: await evaluatorView(scope, evaluator) };
}

export async function archiveEvaluator(
  input: z.output<typeof ArchiveEvaluatorInputSchema>,
  scope: CallerScope,
): Promise<EvaluatorOutput> {
  const evaluator = await loadEvaluator(scope, input.evaluatorId);
  await loadEvaluatedStep(scope, stepRef(evaluator), 'edit');
  await scope.evaluation.setEvaluatorArchived(evaluator, input.archived);
  await appendEvaluationAudit(scope, {
    action: input.archived ? 'evaluator.archived' : 'evaluator.restored',
    description: `Evaluator '${evaluator.name}' ${input.archived ? 'archived' : 'restored'}`,
    namespace: evaluator.namespace,
    entityType: 'evaluator',
    entityId: evaluator.id,
    inputSnapshot: { archived: input.archived },
    basis: 'An archived Evaluator is left out of new Eval Runs; its Scores stay',
  });
  return { evaluator: await evaluatorView(scope, { ...evaluator, archived: input.archived }) };
}

/**
 * Marks an Evaluator to also score live production Agent Runs of its step
 * (D13). The flag may be set on any Evaluator; it takes effect only while
 * the latest version counts (D9), which the view's `production` states.
 */
export async function setEvaluatorProduction(
  input: SetEvaluatorProductionInput,
  scope: CallerScope,
): Promise<EvaluatorOutput> {
  const evaluator = await loadEvaluator(scope, input.evaluatorId);
  await loadEvaluatedStep(scope, stepRef(evaluator), 'edit');
  await scope.evaluation.setEvaluatorRunInProduction(evaluator, input.runInProduction);
  const view = await evaluatorView(scope, { ...evaluator, runInProduction: input.runInProduction });
  await appendEvaluationAudit(scope, {
    action: input.runInProduction === true ? 'evaluator.production_enabled' : 'evaluator.production_disabled',
    description: `Evaluator '${evaluator.name}' ${input.runInProduction === true ? 'set to' : 'no longer set to'} run in production`,
    namespace: evaluator.namespace,
    entityType: 'evaluator',
    entityId: evaluator.id,
    inputSnapshot: { runInProduction: input.runInProduction },
    outputSnapshot: { production: view.production },
    basis: 'A production Evaluator scores live Agent Runs while it counts; a failing critical deterministic one takes the step\'s fallback (ADR-0023 D13)',
  });
  return { evaluator: view };
}
