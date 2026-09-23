import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { evaluatorTrust, type EvalRun, type EvalRunEvaluator, type EvalTrial, type McpEvalServerPolicy } from '@mediforce/platform-core';
import type {
  CancelEvalRunInput,
  EvalRunOutput,
  GetEvalRunInput,
  ListEvalRunsInput,
  ListEvalRunsOutput,
  PrepareEvalRunInputSchema,
  StartEvalRunInput,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { ConflictError, NotFoundError, ValidationError } from '../../errors';
import { loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { appendEvaluationAudit, authorId } from './_lib/audit';
import { estimateEvalRun } from './_lib/estimate-eval-run';
import { buildEvalRunReport } from './_lib/eval-run-report';
import { driveEvalRun } from './_lib/drive-eval-run';

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
 * Prepares an Eval Run (ADR-0023 D4, D10): the Step at its runnable Definition
 * version, a frozen Dataset version, the Step's live Evaluator versions with
 * whether each counts, the MCP eval policy the trials will run under, and a
 * cost estimate. Nothing runs yet — a person confirms the budget with `start`.
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
  if (dataset.namespace !== step.namespace || dataset.workflowName !== step.workflowName || dataset.stepId !== step.stepId) {
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
  const policy = await scope.evaluation.getMcpPolicy(step);
  const mcpPolicy: Record<string, McpEvalServerPolicy> = Object.fromEntries(
    Object.keys(agent?.mcpServers ?? {}).map((name) => [name, policy?.servers[name] ?? { mode: 'deny' as const }]),
  );

  const trialCount = dataset.caseIds.length * input.trialsPerCase;
  const estimate = await estimateEvalRun(scope, step, workflowStep, frozenEvaluators, trialCount);
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
    caseIds: dataset.caseIds,
    trialsPerCase: input.trialsPerCase,
    concurrency: input.concurrency,
    evaluators: frozenEvaluators.map(({ frozen }) => frozen),
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
  const trials: EvalTrial[] = dataset.caseIds.flatMap((caseId) =>
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
      error: null,
      startedAt: null,
      completedAt: null,
    })));
  await scope.evaluation.createEvalRun(run, trials);
  await appendEvaluationAudit(scope, {
    action: 'eval_run.prepared',
    description: `Eval Run prepared for step '${step.stepId}': ${trialCount} trial(s), budget $${budgetUsd}`,
    namespace: step.namespace,
    entityType: 'eval_run',
    entityId: run.id,
    inputSnapshot: { ...step, definitionVersion: run.definitionVersion, datasetVersionId: dataset.id, trialsPerCase: input.trialsPerCase },
    outputSnapshot: { evaluators: run.evaluators, mcpPolicy, estimate, budgetUsd },
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

/** The heartbeat's sweep: move every running Eval Run on, in case a driver died. */
export async function driveRunningEvalRuns(scope: CallerScope): Promise<void> {
  for (const evalRunId of await scope.evaluation.listEvalRunIdsByStatus('running')) {
    try {
      await driveEvalRun(scope, evalRunId);
    } catch (err) {
      console.error(`[eval-run] Failed to drive Eval Run '${evalRunId}':`, err);
    }
  }
}
