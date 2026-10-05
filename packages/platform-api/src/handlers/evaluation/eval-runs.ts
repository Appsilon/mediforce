import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  DEFAULT_ACCEPTANCE_CRITERIA,
  evaluatorTrust,
  resolveDefinitionModels,
  type EvalRun,
  type EvalRunEvaluator,
  type EvalTrial,
  type EvaluatedStep,
  type McpEvalServerPolicy,
  type WorkflowDefinition,
} from '@mediforce/platform-core';
import type {
  CancelEvalRunInput,
  EstimateEvalRunInputSchema,
  EstimateEvalRunOutput,
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
import { buildEvalRunReport, rebuildEvalRunAcceptance, storeEvalRunAcceptance } from './_lib/eval-run-report';
import { driveEvalRun } from './_lib/drive-eval-run';
import { computeStepFingerprint } from './_lib/step-fingerprint';
import { DEFAULT_MCP_EVAL_SERVER_POLICY } from './mcp-eval-policy';
import { checkRetiredModels, checkUnknownModels } from '../workflows/model-checks';

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

/**
 * Refuses an Eval Run whose trials the auto-runner's pre-flight would pause —
 * every one of them, before the agent runs — on a model the registry does not
 * list or has retired: the same checks, on the definition.
 */
async function assertModelsRunnable(scope: CallerScope, definition: WorkflowDefinition): Promise<void> {
  const allModels = await scope.models.list();
  const problem = checkUnknownModels(definition, allModels)
    ?? checkRetiredModels(await resolveDefinitionModels(definition, scope.agentDefinitions), allModels);
  if (problem !== null) throw new ValidationError(`The step cannot run — ${problem.message}`);
}

/** A budget cap with headroom over the estimate, in whole cents. */
function defaultBudget(totalUsd: number): number {
  return Math.max(0.01, Math.ceil(totalUsd * 1.5 * 100) / 100);
}

/**
 * What an Eval Run of the input would run (ADR-0023 D4, D5, D10): the Step at
 * its runnable Definition version — or the `definitionVersion` given, unless
 * archived — with its Step Fingerprint, a frozen Dataset version, the Step's
 * live Evaluator versions with whether each counts, the MCP eval policy the
 * trials will run under, and a cost estimate. Reads only.
 */
async function planEvalRun(input: z.output<typeof EstimateEvalRunInputSchema>, scope: CallerScope) {
  const step = stepRef(input);
  const { definition, step: workflowStep } = await loadEvaluatedStep(scope, step, 'run', input.definitionVersion ?? 'runnable');
  if (definition.archived === true) {
    throw new ValidationError(`'${step.workflowName}' v${definition.version} is archived; evaluate a version still in use`);
  }

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
    agentServers.map((name) => [name, policy?.servers[name] ?? DEFAULT_MCP_EVAL_SERVER_POLICY]),
  );
  await assertModelsRunnable(scope, definition);
  const fingerprint = await computeStepFingerprint(scope, definition, workflowStep);
  const caseIds = dataset.caseIds;
  const estimate = await estimateEvalRun(scope, step, workflowStep, frozenEvaluators, caseIds.length * input.trialsPerCase);
  const suggestedBudgetUsd = estimate.totalUsd === null ? null : defaultBudget(estimate.totalUsd);
  return { step, definition, dataset, frozenEvaluators, mcpPolicy, fingerprint, caseIds, estimate, suggestedBudgetUsd };
}

/**
 * The cost of an Eval Run of the input before it is prepared: its estimate and
 * the budget cap `prepare` would set when none is given. Creates nothing.
 */
export async function estimateEvalRunCost(
  input: z.output<typeof EstimateEvalRunInputSchema>,
  scope: CallerScope,
): Promise<EstimateEvalRunOutput> {
  const plan = await planEvalRun(input, scope);
  return {
    estimate: plan.estimate,
    suggestedBudgetUsd: plan.suggestedBudgetUsd,
    caseCount: plan.caseIds.length,
    trialCount: plan.caseIds.length * input.trialsPerCase,
  };
}

/**
 * Prepares an Eval Run of what `planEvalRun` resolves, frozen with the
 * Acceptance Criteria it will be judged against. Nothing runs yet — a person
 * confirms the budget with `start`.
 */
export async function prepareEvalRun(
  input: z.output<typeof PrepareEvalRunInputSchema>,
  scope: CallerScope,
): Promise<EvalRunOutput> {
  const { step, definition, dataset, frozenEvaluators, mcpPolicy, fingerprint, caseIds, estimate, suggestedBudgetUsd } = await planEvalRun(input, scope);
  const [criteria] = await scope.evaluation.listAcceptanceCriteria(step);
  const trialCount = caseIds.length * input.trialsPerCase;
  const budgetUsd = input.budgetUsd ?? suggestedBudgetUsd;
  if (budgetUsd === null) {
    throw new ValidationError('No cost history or model price for this step — set budgetUsd to cap the run');
  }

  const now = new Date().toISOString();
  const run: EvalRun = {
    ...step,
    id: randomUUID(),
    definitionVersion: definition.version,
    datasetVersionId: dataset.id,
    caseIds,
    trialsPerCase: input.trialsPerCase,
    concurrency: input.concurrency,
    evaluators: frozenEvaluators.map(({ frozen }) => frozen),
    fingerprint,
    acceptanceCriteria: criteria?.criteria ?? DEFAULT_ACCEPTANCE_CRITERIA,
    mcpPolicy,
    estimate,
    budgetUsd,
    spentUsd: 0,
    status: 'prepared',
    createdBy: authorId(scope),
    createdAt: now,
    startedAt: null,
    completedAt: null,
    acceptance: null,
  };
  const trials: EvalTrial[] = caseIds.flatMap((caseId) =>
    Array.from({ length: input.trialsPerCase }, (_unused, trialIndex) => ({
      id: randomUUID(),
      evalRunId: run.id,
      caseId,
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
      mcpReplayMisses: [],
      erroredJudgeCalls: {},
    })));
  await scope.evaluation.createEvalRun(run, trials);
  await appendEvaluationAudit(scope, {
    action: 'eval_run.prepared',
    description: `Eval Run prepared for step '${step.stepId}': ${trialCount} trial(s), budget $${budgetUsd}`,
    namespace: step.namespace,
    entityType: 'eval_run',
    entityId: run.id,
    inputSnapshot: { ...step, definitionVersion: run.definitionVersion, datasetVersionId: dataset.id, trialsPerCase: input.trialsPerCase },
    outputSnapshot: {
      evaluators: run.evaluators,
      fingerprint,
      acceptanceCriteria: run.acceptanceCriteria,
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
  const { definition } = await loadEvaluatedStep(scope, stepRef(run), 'run', run.definitionVersion);
  if (input.confirmedBudgetUsd !== run.budgetUsd) {
    const estimate = run.estimate.totalUsd === null ? 'no estimate' : `estimated $${run.estimate.totalUsd}`;
    throw new ValidationError(
      `Starting this Eval Run spends up to $${run.budgetUsd} (${estimate}); a person must confirm that budget`,
    );
  }
  await assertModelsRunnable(scope, definition);
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

/**
 * The Step's Eval Runs, newest first, each with how its champion fared on its
 * criteria as stored on the run. A run that finished before acceptance was
 * stored has it rebuilt from its report; a read never writes it.
 */
export async function listEvalRuns(input: ListEvalRunsInput, scope: CallerScope): Promise<ListEvalRunsOutput> {
  await loadEvaluatedStep(scope, input, 'read');
  const runs = await scope.evaluation.listEvalRuns(stepRef(input));
  return {
    evalRuns: await Promise.all(runs.map(async (run) => {
      if (run.acceptance !== null || run.status === 'prepared' || run.status === 'running') return run;
      return { ...run, acceptance: await rebuildEvalRunAcceptance(scope, run) };
    })),
  };
}

/** Stops an Eval Run: no new trial starts; trials already running finish and are scored. */
export async function cancelEvalRun(input: CancelEvalRunInput, scope: CallerScope): Promise<EvalRunOutput> {
  const run = await loadEvalRun(scope, input.evalRunId);
  await loadEvaluatedStep(scope, stepRef(run), 'run', run.definitionVersion);
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
  await storeEvalRunAcceptance(scope, { ...run, status: 'cancelled', completedAt: now });
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
