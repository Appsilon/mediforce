import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  CHAMPION_VARIANT_ID,
  applyStepVariant,
  evaluatorTrust,
  isEmptyVariantPatch,
  variantPatchProblem,
  type EvalRun,
  type EvalRunEvaluator,
  type EvalTrial,
  type EvalVariant,
  type EvaluatedStep,
  type McpEvalServerPolicy,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@mediforce/platform-core';
import type {
  CancelEvalRunInput,
  EvalChallenger,
  EvalRunOutput,
  GetEvalRunInput,
  ListEvalRunsInput,
  ListEvalRunsOutput,
  PrepareEvalRunInputSchema,
  StartEvalRunInput,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { ConflictError, NotFoundError, ValidationError } from '../../errors';
import { isSameStep, loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { appendEvaluationAudit, authorId } from './_lib/audit';
import { estimateEvalRun } from './_lib/estimate-eval-run';
import { buildEvalRunReport } from './_lib/eval-run-report';
import { driveEvalRun } from './_lib/drive-eval-run';
import { computeStepFingerprint } from './_lib/step-fingerprint';
import { exampleCasesProblem } from './_lib/example-cases';

async function loadEvalRun(scope: CallerScope, evalRunId: string): Promise<EvalRun> {
  const run = await scope.evaluation.getEvalRun(evalRunId);
  if (run === null) throw new NotFoundError(`Eval Run '${evalRunId}' not found`);
  return run;
}

async function evalRunOutput(scope: CallerScope, evalRunId: string): Promise<EvalRunOutput> {
  const evalRun = await loadEvalRun(scope, evalRunId);
  const trials = await scope.evaluation.listTrials(evalRunId);
  return { evalRun, trials, report: await buildEvalRunReport(scope, evalRun, trials) };
}

/** A budget cap with headroom over the estimate, in whole cents. */
function defaultBudget(totalUsd: number): number {
  return Math.max(0.01, Math.ceil(totalUsd * 1.5 * 100) / 100);
}

/**
 * The run's variants (D5): the champion — the Step as its Definition version
 * has it — then each challenger, a patch over it, each with its Step
 * Fingerprint. A challenger must change something the Fingerprint sees, and
 * no two variants may be the same Step. The few-shot examples a challenger
 * brings must come from cases it may use (D12).
 */
async function buildVariants(
  scope: CallerScope,
  step: EvaluatedStep,
  definition: WorkflowDefinition,
  workflowStep: WorkflowStep,
  agentServers: readonly string[],
  challengers: readonly EvalChallenger[],
): Promise<EvalVariant[]> {
  const champion: EvalVariant = {
    id: CHAMPION_VARIANT_ID,
    label: 'Current step',
    patch: {},
    fingerprint: await computeStepFingerprint(scope, definition, workflowStep),
  };
  const variants = [champion];
  for (const [index, challenger] of challengers.entries()) {
    const label = `Challenger '${challenger.label}'`;
    if (isEmptyVariantPatch(challenger.patch)) throw new ValidationError(`${label} changes nothing about the step`);
    const problem = variantPatchProblem(definition, challenger.patch);
    if (problem !== null) throw new ValidationError(`${label}: ${problem}`);
    const examplesProblem = await exampleCasesProblem(scope, step, challenger.patch.examples ?? []);
    if (examplesProblem !== null) throw new ValidationError(`${label}: ${examplesProblem}`);
    const unknownServers = Object.keys(challenger.patch.mcpRestrictions ?? {}).filter((name) => agentServers.includes(name) === false);
    if (unknownServers.length > 0) {
      throw new ValidationError(`${label} restricts MCP servers the step's agent does not bind: ${unknownServers.join(', ')}`);
    }
    const patched = applyStepVariant(definition, workflowStep, challenger.patch);
    const fingerprint = await computeStepFingerprint(scope, patched.definition, patched.step);
    const same = variants.find((variant) => variant.fingerprint?.hash === fingerprint.hash);
    if (same !== undefined) throw new ValidationError(`${label} runs the same step as '${same.label}'`);
    variants.push({ id: `challenger-${index + 1}`, label: challenger.label, patch: challenger.patch, fingerprint });
  }
  return variants;
}

/**
 * Prepares an Eval Run (ADR-0023 D4, D5, D10): the Step at its runnable
 * Definition version and any challengers patched over it, a frozen Dataset
 * version less the cases any variant's few-shot examples came from (D12), the
 * Step's live Evaluator versions with whether each counts, the MCP eval policy
 * the trials will run under, the Acceptance Criteria and Brief version it will
 * be judged against, and a cost estimate. Nothing runs yet — a person confirms
 * the budget with `start`.
 */
export async function prepareEvalRun(
  input: z.output<typeof PrepareEvalRunInputSchema>,
  scope: CallerScope,
): Promise<EvalRunOutput> {
  const step = stepRef(input);
  const { definition, step: workflowStep } = await loadEvaluatedStep(scope, step, 'run');

  const dataset = input.datasetVersionId === undefined
    ? (await scope.evaluation.listDatasetVersions(step))[0]
    : await scope.evaluation.getDatasetVersion(input.datasetVersionId);
  if (dataset === undefined || dataset === null) {
    throw new ValidationError(`Step '${step.stepId}' has no frozen Eval Dataset — freeze its cases first`);
  }
  if (isSameStep(dataset, step) === false) {
    throw new ValidationError(`Eval Dataset '${dataset.id}' belongs to another step`);
  }

  const frozenEvaluators = [];
  for (const evaluator of await scope.evaluation.listEvaluators(step)) {
    if (evaluator.archived) continue;
    const versions = await scope.evaluation.listEvaluatorVersions(evaluator.id);
    const version = versions[versions.length - 1]!;
    const trust = evaluatorTrust(version);
    const frozen: EvalRunEvaluator = {
      evaluatorId: evaluator.id,
      name: evaluator.name,
      version: version.version,
      kind: version.check.kind,
      ...(version.check.kind === 'builtin' ? { builtin: version.check.name } : {}),
      severity: version.severity,
      counted: trust.trusted,
      ...(trust.trusted ? {} : { reason: trust.reason }),
    };
    frozenEvaluators.push({ frozen, version });
  }
  if (frozenEvaluators.length === 0) throw new ValidationError(`Step '${step.stepId}' has no Evaluators to run`);

  const agent = workflowStep.agentId === undefined ? null : await scope.agentDefinitions.getById(workflowStep.agentId);
  const agentServers = Object.keys(agent?.mcpServers ?? {});
  const policy = await scope.evaluation.getMcpPolicy(step);
  const mcpPolicy: Record<string, McpEvalServerPolicy> = Object.fromEntries(
    agentServers.map((name) => [name, policy?.servers[name] ?? { mode: 'deny' as const }]),
  );
  const variants = await buildVariants(scope, step, definition, workflowStep, agentServers, input.challengers);
  const exampleSources = new Set([
    ...(workflowStep.agent?.examples ?? []),
    ...input.challengers.flatMap((challenger) => challenger.patch.examples ?? []),
  ].flatMap((example) => example.caseId === undefined ? [] : [example.caseId]));
  const caseIds = dataset.caseIds.filter((caseId) => exampleSources.has(caseId) === false);
  const exampleCaseIds = dataset.caseIds.filter((caseId) => exampleSources.has(caseId));
  if (caseIds.length === 0) {
    throw new ValidationError(
      `Every case of Eval Dataset v${dataset.version} is a variant's few-shot example — no case left to score`,
    );
  }
  const [criteria] = await scope.evaluation.listAcceptanceCriteria(step);
  const [brief] = await scope.evaluation.listBriefs(step);

  const trialsPerVariant = caseIds.length * input.trialsPerCase;
  const trialCount = trialsPerVariant * variants.length;
  const estimate = await estimateEvalRun(scope, step, workflowStep, frozenEvaluators, variants, trialsPerVariant);
  const budgetUsd = input.budgetUsd ?? (estimate.totalUsd === null ? undefined : defaultBudget(estimate.totalUsd));
  if (budgetUsd === undefined) {
    throw new ValidationError('No cost history or model price for this step — set budgetUsd to cap the run');
  }

  const now = new Date().toISOString();
  const run: EvalRun = {
    ...step,
    id: randomUUID(),
    definitionVersion: definition.version,
    datasetVersionId: dataset.id,
    caseIds,
    exampleCaseIds,
    trialsPerCase: input.trialsPerCase,
    concurrency: input.concurrency,
    evaluators: frozenEvaluators.map(({ frozen }) => frozen),
    variants,
    acceptanceCriteria: criteria?.criteria ?? null,
    briefVersion: brief?.version ?? null,
    mcpPolicy,
    estimate,
    budgetUsd,
    spentUsd: 0,
    status: 'prepared',
    createdBy: authorId(scope),
    createdAt: now,
    startedAt: null,
    completedAt: null,
  };
  const trials: EvalTrial[] = caseIds.flatMap((caseId) => variants.flatMap((variant) =>
    Array.from({ length: input.trialsPerCase }, (_unused, trialIndex) => ({
      id: randomUUID(),
      evalRunId: run.id,
      caseId,
      variantId: variant.id,
      trialIndex,
      status: 'pending' as const,
      processInstanceId: null,
      agentRunId: null,
      costUsd: null,
      inputTokens: null,
      outputTokens: null,
      durationMs: null,
      confidence: null,
      error: null,
      startedAt: null,
      scoringStartedAt: null,
      scoringAttempts: 0,
      completedAt: null,
    }))));
  await scope.evaluation.createEvalRun(run, trials);
  await appendEvaluationAudit(scope, {
    action: 'eval_run.prepared',
    description: `Eval Run prepared for step '${step.stepId}': ${variants.length} variant(s), ${trialCount} trial(s), budget $${budgetUsd}`,
    namespace: step.namespace,
    entityType: 'eval_run',
    entityId: run.id,
    inputSnapshot: { ...step, definitionVersion: run.definitionVersion, datasetVersionId: dataset.id, trialsPerCase: input.trialsPerCase },
    outputSnapshot: {
      evaluators: run.evaluators,
      variants,
      exampleCaseIds,
      acceptanceCriteria: run.acceptanceCriteria,
      briefVersion: run.briefVersion,
      mcpPolicy,
      estimate,
      budgetUsd,
    },
    basis: 'Eval Run prepared with a cost estimate for a person to confirm (ADR-0023 D15)',
  });
  return evalRunOutput(scope, run.id);
}

/**
 * Starts a prepared Eval Run once a person confirms its budget (D15). The
 * confirmation is the budget they were shown, echoed back; without it — which
 * is how the Evaluation Assistant's tool call arrives — the start is refused.
 */
export async function startEvalRun(input: StartEvalRunInput, scope: CallerScope): Promise<EvalRunOutput> {
  const run = await loadEvalRun(scope, input.evalRunId);
  await loadEvaluatedStep(scope, stepRef(run), 'run');
  if (input.confirmedBudgetUsd !== run.budgetUsd) {
    const estimate = run.estimate.totalUsd === null ? 'no estimate' : `estimated $${run.estimate.totalUsd}`;
    throw new ValidationError(
      `Starting this Eval Run spends up to $${run.budgetUsd} (${estimate}); a person must confirm that budget`,
    );
  }
  const started = await scope.evaluation.transitionEvalRun(run.id, 'prepared', {
    status: 'running',
    startedAt: new Date().toISOString(),
  });
  if (!started) throw new ConflictError(`Eval Run '${run.id}' is ${run.status}, not prepared`);
  await appendEvaluationAudit(scope, {
    action: 'eval_run.started',
    description: `Eval Run '${run.id}' started with a budget of $${run.budgetUsd}`,
    namespace: run.namespace,
    entityType: 'eval_run',
    entityId: run.id,
    inputSnapshot: { confirmedBudgetUsd: input.confirmedBudgetUsd },
    outputSnapshot: { estimate: run.estimate },
    basis: 'A person confirmed the Eval Run budget (ADR-0023 D15)',
  });
  await driveEvalRun(scope, run.id);
  return evalRunOutput(scope, run.id);
}

export async function getEvalRun(input: GetEvalRunInput, scope: CallerScope): Promise<EvalRunOutput> {
  return evalRunOutput(scope, input.evalRunId);
}

export async function listEvalRuns(input: ListEvalRunsInput, scope: CallerScope): Promise<ListEvalRunsOutput> {
  await loadEvaluatedStep(scope, input, 'read');
  return { evalRuns: await scope.evaluation.listEvalRuns(stepRef(input)) };
}

/** Stops an Eval Run: no new trial starts; trials already running finish and are scored. */
export async function cancelEvalRun(input: CancelEvalRunInput, scope: CallerScope): Promise<EvalRunOutput> {
  const run = await loadEvalRun(scope, input.evalRunId);
  await loadEvaluatedStep(scope, stepRef(run), 'run');
  const now = new Date().toISOString();
  const cancelled = await scope.evaluation.transitionEvalRun(run.id, run.status === 'prepared' ? 'prepared' : 'running', {
    status: 'cancelled',
    completedAt: now,
  });
  if (!cancelled) throw new ConflictError(`Eval Run '${run.id}' is already ${run.status}`);
  for (const trial of await scope.evaluation.listTrials(run.id)) {
    if (trial.status === 'pending') {
      await scope.evaluation.transitionTrial(trial, 'pending', { status: 'skipped', error: 'Eval Run cancelled', completedAt: now });
    }
  }
  await appendEvaluationAudit(scope, {
    action: 'eval_run.cancelled',
    description: `Eval Run '${run.id}' cancelled`,
    namespace: run.namespace,
    entityType: 'eval_run',
    entityId: run.id,
    inputSnapshot: {},
    basis: 'A person stopped the Eval Run',
  });
  return evalRunOutput(scope, run.id);
}

/**
 * The auto-runner's hook: when a Workflow Run ends and it was an eval trial,
 * move its Eval Run on. A no-op for any other run.
 */
export async function advanceEvalRunOfInstance(scope: CallerScope, processInstanceId: string): Promise<void> {
  const trial = await scope.evaluation.getTrialByInstanceId(processInstanceId);
  if (trial !== null) await driveEvalRun(scope, trial.evalRunId);
}

/**
 * The heartbeat's sweep: move on every Eval Run that is running or still has
 * a trial in flight — a cancelled one included — in case a driver died.
 */
export async function driveOpenEvalRuns(scope: CallerScope): Promise<void> {
  for (const evalRunId of await scope.evaluation.listEvalRunIdsToDrive()) {
    try {
      await driveEvalRun(scope, evalRunId);
    } catch (err) {
      console.error(`[eval-run] Failed to drive Eval Run '${evalRunId}':`, err);
    }
  }
}
