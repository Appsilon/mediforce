import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { evaluationOwnerOf, isMovingModelAlias, type Evaluator, type EvaluatorCheck } from '@mediforce/platform-core';
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
import { ConflictError, ValidationError } from '../../errors';
import { loadEvaluationSubject, subjectRef, subjectName } from './_lib/evaluation-subject';
import { evaluatorView, loadEvaluator } from './_lib/evaluator-view';
import { appendEvaluationAudit, authorId } from './_lib/audit';

export async function listEvaluators(
  input: z.output<typeof ListEvaluatorsInputSchema>,
  scope: CallerScope,
): Promise<ListEvaluatorsOutput> {
  await loadEvaluationSubject(scope, input, 'read');
  const evaluators = await scope.evaluation.listEvaluators(subjectRef(input));
  const shown = input.includeArchived === true ? evaluators : evaluators.filter((evaluator) => !evaluator.archived);
  return { evaluators: await Promise.all(shown.map((evaluator) => evaluatorView(scope, evaluator))) };
}

export async function getEvaluator(input: GetEvaluatorInput, scope: CallerScope): Promise<EvaluatorOutput> {
  return { evaluator: await evaluatorView(scope, await loadEvaluator(scope, input.evaluatorId)) };
}

/** A version is immutable (ADR-0023 D7), so its judge must name one model, not an alias that moves. */
function assertPinnedJudgeModel(check: EvaluatorCheck): void {
  if ('model' in check && isMovingModelAlias(check.model)) {
    throw new ValidationError(`The judge model '${check.model}' is an alias whose model changes under the same name; pick a concrete model so this Evaluator version keeps meaning what it scored`);
  }
}

/** A step has one output-schema check: the step's output either matches its JSON Schema or does not. */
export async function liveSchemaEvaluatorName(scope: CallerScope, step: ReturnType<typeof subjectRef>, except?: string): Promise<string | null> {
  const evaluators = await scope.evaluation.listEvaluators(step);
  for (const evaluator of evaluators) {
    if (evaluator.archived || evaluator.id === except) continue;
    if ((await evaluatorView(scope, evaluator)).latest.check.kind === 'schema') return evaluator.name;
  }
  return null;
}

async function assertSingleSchemaEvaluator(scope: CallerScope, step: ReturnType<typeof subjectRef>, except?: string): Promise<void> {
  const taken = await liveSchemaEvaluatorName(scope, step, except);
  if (taken !== null) throw new ConflictError(`${subjectName(step)} already has an output schema check ('${taken}'); a step has one`);
}

const NOT_IN_PRODUCTION = 'An expected-output check never runs in production: a production run has no expected output to compare with';
const AGENT_NOT_IN_PRODUCTION = 'An agent\'s Evaluator never runs in production: production runs belong to the workflow steps that use the agent (ADR-0029)';

/** An Evaluator starts at version 1. A `code` check counts once a person approves its source; the others at once (D9). */
export async function createEvaluator(
  input: z.output<typeof CreateEvaluatorInputSchema>,
  scope: CallerScope,
): Promise<EvaluatorOutput> {
  const step = subjectRef(input);
  await loadEvaluationSubject(scope, step, 'edit');
  const existing = await scope.evaluation.listEvaluators(step);
  const sameName = existing.find((evaluator) => evaluator.name === input.name);
  if (input.check.kind === 'schema') await assertSingleSchemaEvaluator(scope, step);
  if (sameName !== undefined) {
    const archivedSchema = sameName.archived && (await evaluatorView(scope, sameName)).latest.check.kind === 'schema';
    if (input.check.kind !== 'schema' || !archivedSchema) {
      throw new ConflictError(`${subjectName(step)} already has an Evaluator named '${input.name}'`);
    }
    await archiveEvaluator({ evaluatorId: sameName.id, archived: false }, scope);
    return addEvaluatorVersion({ evaluatorId: sameName.id, rule: input.rule, check: input.check, origin: input.origin }, scope);
  }

  const now = new Date().toISOString();
  const createdBy = authorId(scope);
  const runInProduction = input.runInProduction ?? false;
  if (runInProduction === true && input.check.kind === 'expected_output') throw new ValidationError(NOT_IN_PRODUCTION);
  if (runInProduction === true && step.kind === 'agent') throw new ValidationError(AGENT_NOT_IN_PRODUCTION);
  assertPinnedJudgeModel(input.check);
  const evaluator = {
    ...evaluationOwnerOf(step),
    id: randomUUID(),
    name: input.name,
    archived: false,
    runInProduction,
    onError: 'ignore' as const,
    createdBy,
    createdAt: now,
  };
  await scope.evaluation.createEvaluator(evaluator, {
    evaluatorId: evaluator.id,
    version: 1,
    rule: input.rule,
    check: input.check,
    origin: input.origin,
    sourceApproval: null,
    createdBy,
    createdAt: now,
  });
  await appendEvaluationAudit(scope, {
    action: 'evaluator.created',
    description: `Evaluator '${input.name}' (${input.check.kind}) created for ${subjectName(step, false)}`,
    namespace: step.namespace,
    entityType: 'evaluator',
    entityId: evaluator.id,
    inputSnapshot: {
      ...evaluationOwnerOf(step),
      name: input.name,
      rule: input.rule,
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
 * meaning what they meant for the Scores they produced. A source approval
 * belongs to a version, so a new version starts without one.
 */
export async function addEvaluatorVersion(
  input: z.output<typeof AddEvaluatorVersionInputSchema>,
  scope: CallerScope,
): Promise<EvaluatorOutput> {
  const evaluator = await loadEvaluator(scope, input.evaluatorId);
  await loadEvaluationSubject(scope, subjectRef(evaluator), 'edit');
  const { latest } = await evaluatorView(scope, evaluator);
  if (input.check !== undefined && (input.check.kind === 'expected_output') !== (latest.check.kind === 'expected_output')) {
    throw new ValidationError(`Evaluator '${evaluator.name}' is ${latest.check.kind === 'expected_output' ? 'an expected-output check and stays one' : `a ${latest.check.kind} check and cannot become an expected-output check`}`);
  }
  if (input.check !== undefined) assertPinnedJudgeModel(input.check);
  if (input.check?.kind === 'schema' && latest.check.kind !== 'schema') await assertSingleSchemaEvaluator(scope, subjectRef(evaluator), evaluator.id);
  const version = await scope.evaluation.appendEvaluatorVersion(evaluator, {
    evaluatorId: evaluator.id,
    version: latest.version + 1,
    rule: input.rule ?? latest.rule,
    check: input.check ?? latest.check,
    origin: input.origin,
    sourceApproval: null,
    createdBy: authorId(scope),
    createdAt: new Date().toISOString(),
  });
  await appendEvaluationAudit(scope, {
    action: 'evaluator.version_created',
    description: `Evaluator '${evaluator.name}' v${version.version} created`,
    namespace: evaluator.namespace,
    entityType: 'evaluator',
    entityId: evaluator.id,
    inputSnapshot: { rule: version.rule, check: version.check, origin: version.origin },
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
  await loadEvaluationSubject(scope, subjectRef(evaluator), 'edit');
  if (input.archived === false && (await evaluatorView(scope, evaluator)).latest.check.kind === 'schema') {
    await assertSingleSchemaEvaluator(scope, subjectRef(evaluator), evaluator.id);
  }
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

function describeProductionChange(evaluator: Evaluator, input: SetEvaluatorProductionInput): { action: string; description: string } {
  if (input.runInProduction !== undefined) {
    return {
      action: input.runInProduction === true ? 'evaluator.production_enabled' : 'evaluator.production_disabled',
      description: `Evaluator '${evaluator.name}' ${input.runInProduction === true ? 'set to' : 'no longer set to'} run in production`,
    };
  }
  return {
    action: 'evaluator.production_on_error_set',
    description: `Evaluator '${evaluator.name}' set to ${input.onError === 'escalate' ? 'escalate the run' : 'let the run continue'} when it cannot run in production`,
  };
}

/**
 * Marks an Evaluator to also score live production Agent Runs of its step
 * (D13), and whether a check that cannot run there escalates the run. The
 * flag may be set on any Evaluator; it takes effect only while the latest
 * version counts (D9), which the view's `production` states.
 */
export async function setEvaluatorProduction(
  input: SetEvaluatorProductionInput,
  scope: CallerScope,
): Promise<EvaluatorOutput> {
  const evaluator = await loadEvaluator(scope, input.evaluatorId);
  await loadEvaluationSubject(scope, subjectRef(evaluator), 'edit');
  if (input.runInProduction === true && evaluator.agentId !== null) throw new ValidationError(AGENT_NOT_IN_PRODUCTION);
  if (input.runInProduction === true && (await evaluatorView(scope, evaluator)).latest.check.kind === 'expected_output') {
    throw new ValidationError(NOT_IN_PRODUCTION);
  }
  const settings = {
    runInProduction: input.runInProduction ?? evaluator.runInProduction,
    onError: input.onError ?? evaluator.onError,
  };
  await scope.evaluation.setEvaluatorProduction(evaluator, settings);
  const view = await evaluatorView(scope, { ...evaluator, ...settings });
  await appendEvaluationAudit(scope, {
    ...describeProductionChange(evaluator, input),
    namespace: evaluator.namespace,
    entityType: 'evaluator',
    entityId: evaluator.id,
    inputSnapshot: { runInProduction: input.runInProduction, onError: input.onError },
    outputSnapshot: { production: view.production, onError: view.onError },
    basis: 'A production Evaluator scores live Agent Runs while it counts; a failing deterministic one, or one set to escalate that cannot run, sends the run to a person (ADR-0023 D13)',
  });
  return { evaluator: view };
}
