import { randomUUID } from 'node:crypto';
import type { EvalCase, EvalRun, EvalTrial } from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { recordScore } from '../../scores/record-score';
import { loadEvaluationSubject } from './evaluation-subject';
import { priceOf } from './estimate-eval-run';
import { runEvaluatorCheck, type JudgeUsage } from './run-evaluator-check';

/**
 * How long a driver may hold a trial — between claiming it and creating its
 * run, or scoring it, renewed before each Evaluator — before another driver
 * decides it died.
 */
const CLAIM_LEASE_MS = 15 * 60_000;

/** A trial's run is done when nothing will move it any further. */
function runIsDone(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'paused';
}

function claimIsStale(claimedAt: string | null, staleBefore: string): boolean {
  return claimedAt !== null && Date.parse(claimedAt) < Date.parse(staleBefore);
}

/** What the judge calls cost, at the model registry's prices; a model it does not price adds nothing. */
async function judgeCostUsd(scope: CallerScope, usages: readonly JudgeUsage[]): Promise<number> {
  let total = 0;
  for (const usage of usages) {
    total += (await priceOf(scope, usage.model, { input: usage.promptTokens, output: usage.completionTokens })) ?? 0;
  }
  return total;
}

/**
 * Applies the run's frozen Evaluator versions to one finished trial the caller
 * holds the `scoring` claim on, and records a Score per Evaluator that could
 * grade it. An Evaluator that already scored this trial — before a driver died
 * mid-scoring — is not run again.
 */
async function scoreTrial(scope: CallerScope, run: EvalRun, trial: EvalTrial, evalCase: EvalCase | null): Promise<void> {
  const instanceId = trial.processInstanceId!;
  const instance = await scope.runs.getById(instanceId);
  const agentRun = (await scope.agentRuns.getByInstanceId(instanceId))
    .filter((candidate) => candidate.stepId === run.stepId && candidate.status !== 'running')
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  const completedAt = new Date().toISOString();

  if (agentRun === undefined) {
    await scope.evaluation.transitionTrial(trial, 'scoring', {
      status: 'failed',
      error: instance?.error ?? 'The trial ended without an Agent Run',
      completedAt,
    });
    return;
  }

  const execution = (await scope.runs.getStepExecutions(instanceId))
    .filter((candidate) => candidate.stepId === run.stepId)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  const agentOutput = execution?.agentOutput ?? null;
  const subject = await loadEvaluationSubject(scope, agentRun.id);
  const alreadyScored = new Set(
    (await scope.scores.list({ processInstanceId: instanceId, stepId: run.stepId, limit: 1000 }))
      .filter((score) => score.metadata?.trialId === trial.id)
      .map((score) => score.evaluatorId),
  );
  const judgeUsages: JudgeUsage[] = [];
  const errors: string[] = [];
  for (const frozen of run.evaluators) {
    if (alreadyScored.has(frozen.evaluatorId)) continue;
    // Keep the claim fresh, so a long pass over many Evaluators never looks like a dead driver's.
    await scope.evaluation.transitionTrial(trial, 'scoring', { scoringStartedAt: new Date().toISOString() });
    const version = (await scope.evaluation.listEvaluatorVersions(frozen.evaluatorId))
      .find((candidate) => candidate.version === frozen.version);
    if (version === undefined) {
      errors.push(`${frozen.name}: version ${frozen.version} not found`);
      continue;
    }
    const outcome = await runEvaluatorCheck(scope, version.check, subject, evalCase, (usage) => judgeUsages.push(usage));
    if (outcome.passed === null || outcome.value === null) {
      errors.push(`${frozen.name}: ${outcome.error ?? 'no verdict'}`);
      continue;
    }
    await recordScore({
      subject: { type: 'agent_run', id: agentRun.id },
      name: frozen.name,
      value: outcome.value,
      label: outcome.label,
      comment: outcome.comment,
      source: frozen.kind === 'llm_judge' ? 'llm_judge' : 'deterministic',
      createdBy: null,
      metadata: {
        evalRunId: run.id,
        trialId: trial.id,
        caseId: trial.caseId,
        evaluatorVersion: frozen.version,
        counted: frozen.counted,
      },
      namespace: run.namespace,
      processInstanceId: instanceId,
      stepId: run.stepId,
      evaluatorId: frozen.evaluatorId,
      supersedes: null,
      basis: `Evaluator '${frozen.name}' v${frozen.version} on Eval Run '${run.id}' (ADR-0023)`,
    }, scope);
  }

  const agentCostUsd = agentOutput?.estimatedCostUsd ?? null;
  const judgesUsd = await judgeCostUsd(scope, judgeUsages);
  const costUsd = agentCostUsd === null && judgesUsd === 0 ? null : (agentCostUsd ?? 0) + judgesUsd;
  const scored = await scope.evaluation.transitionTrial(trial, 'scoring', {
    status: 'scored',
    agentRunId: agentRun.id,
    costUsd,
    inputTokens: agentOutput?.tokenUsage?.inputTokens ?? null,
    outputTokens: agentOutput?.tokenUsage?.outputTokens ?? null,
    durationMs: agentOutput?.duration_ms === null || agentOutput?.duration_ms === undefined ? null : Math.round(agentOutput.duration_ms),
    error: errors.length === 0 ? null : errors.join('; '),
    completedAt,
  });
  if (scored === true && costUsd !== null) await scope.evaluation.addEvalRunSpend(run.id, costUsd);
}

/**
 * Starts one pending trial as a single-step Workflow Run at the target Step.
 * The claim `pending → running` already names the run it will create, so a
 * trial always knows its run and a run is never left without its trial.
 */
async function startTrial(scope: CallerScope, run: EvalRun, trial: EvalTrial, evalCase: EvalCase | null): Promise<void> {
  const processInstanceId = randomUUID();
  const claimed = await scope.evaluation.transitionTrial(trial, 'pending', {
    status: 'running',
    processInstanceId,
    startedAt: new Date().toISOString(),
  });
  if (claimed === false) return;
  if (evalCase === null) {
    await scope.evaluation.transitionTrial(trial, 'running', { status: 'failed', error: `Eval Case '${trial.caseId}' not found`, completedAt: new Date().toISOString() });
    return;
  }
  try {
    await scope.system.engine.createEvalTrial({
      id: processInstanceId,
      namespace: run.namespace,
      definitionName: run.workflowName,
      version: run.definitionVersion,
      stepId: run.stepId,
      evalRunId: run.id,
      triggerPayload: evalCase.input.triggerPayload,
      variables: evalCase.input.previousStepOutputs,
      ...(evalCase.input.previousRun === undefined ? {} : { previousRun: evalCase.input.previousRun }),
      workspaceStartCommit: evalCase.workspaceSeedCommit,
      createdBy: run.createdBy,
    });
  } catch (err) {
    // The run may exist even though creating it threw; then it is kicked, run and scored like any other.
    if ((await scope.runs.getById(processInstanceId)) === null) {
      await scope.evaluation.transitionTrial(trial, 'running', {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date().toISOString(),
      });
      return;
    }
  }
  await scope.system.runKicker.kick(processInstanceId, { triggeredBy: `eval-run:${run.id}` });
}

/**
 * Moves an Eval Run forward, and is safe to call any number of times from
 * anywhere — the start handler, the auto-runner when a trial's run ends, the
 * heartbeat. It scores finished trials and takes over claims a dead driver
 * left behind; on a running Eval Run it then stops starting new trials once
 * spend reaches the budget (skipping the rest), starts pending trials up to
 * the run's concurrency, and closes the run when no trial is left in flight.
 * A cancelled Eval Run only has the trials it had in flight scored.
 */
export async function driveEvalRun(scope: CallerScope, evalRunId: string): Promise<void> {
  const initial = await scope.evaluation.getEvalRun(evalRunId);
  if (initial === null || (initial.status !== 'running' && initial.status !== 'cancelled')) return;

  const cases = new Map<string, EvalCase | null>();
  const caseFor = async (caseId: string): Promise<EvalCase | null> => {
    if (!cases.has(caseId)) cases.set(caseId, await scope.evaluation.getCase(caseId));
    return cases.get(caseId) ?? null;
  };

  const staleBefore = new Date(Date.now() - CLAIM_LEASE_MS).toISOString();
  for (const trial of await scope.evaluation.listTrials(evalRunId)) {
    if (trial.status === 'scoring') {
      if (claimIsStale(trial.scoringStartedAt, staleBefore) === false) continue;
      const takenOver = await scope.evaluation.renewScoringClaim(trial, staleBefore, new Date().toISOString());
      if (takenOver === true) await scoreTrial(scope, initial, trial, await caseFor(trial.caseId));
      continue;
    }
    if (trial.status !== 'running' || trial.processInstanceId === null) continue;
    const instance = await scope.runs.getById(trial.processInstanceId);
    if (instance === null) {
      if (claimIsStale(trial.startedAt, staleBefore) === true) {
        await scope.evaluation.transitionTrial(trial, 'running', {
          status: 'failed',
          error: 'The trial\'s Workflow Run was never created',
          completedAt: new Date().toISOString(),
        });
      }
      continue;
    }
    if (runIsDone(instance.status) === false) continue;
    const claimed = await scope.evaluation.transitionTrial(trial, 'running', { status: 'scoring', scoringStartedAt: new Date().toISOString() });
    if (claimed === false) continue;
    await scoreTrial(scope, initial, trial, await caseFor(trial.caseId));
  }

  const run = (await scope.evaluation.getEvalRun(evalRunId))!;
  if (run.status !== 'running') return;
  const trials = await scope.evaluation.listTrials(evalRunId);
  const pending = trials.filter((trial) => trial.status === 'pending');
  const inFlight = trials.filter((trial) => trial.status === 'running' || trial.status === 'scoring').length;
  const budgetReached = run.spentUsd >= run.budgetUsd;

  if (budgetReached) {
    for (const trial of pending) {
      await scope.evaluation.transitionTrial(trial, 'pending', {
        status: 'skipped',
        error: `Budget of $${run.budgetUsd} reached`,
        completedAt: new Date().toISOString(),
      });
    }
  } else {
    for (const trial of pending.slice(0, Math.max(0, run.concurrency - inFlight))) {
      await startTrial(scope, run, trial, await caseFor(trial.caseId));
    }
  }

  const after = await scope.evaluation.listTrials(evalRunId);
  const open = after.some((trial) => trial.status === 'pending' || trial.status === 'running' || trial.status === 'scoring');
  if (open) return;
  const closed = await scope.evaluation.transitionEvalRun(evalRunId, 'running', {
    status: after.some((trial) => trial.status === 'skipped') ? 'budget_exceeded' : 'completed',
    completedAt: new Date().toISOString(),
  });
  if (closed) {
    await scope.system.audit.append({
      actorId: 'eval-run-driver',
      actorType: 'system',
      actorRole: 'orchestrator',
      action: 'eval_run.finished',
      description: `Eval Run '${evalRunId}' finished: ${after.filter((trial) => trial.status === 'scored').length}/${after.length} trials scored`,
      timestamp: new Date().toISOString(),
      inputSnapshot: { evalRunId },
      outputSnapshot: { spentUsd: run.spentUsd, budgetUsd: run.budgetUsd, skipped: after.filter((trial) => trial.status === 'skipped').length },
      basis: 'Every trial of the Eval Run is scored, failed or skipped',
      entityType: 'eval_run',
      entityId: evalRunId,
      namespace: run.namespace,
    });
  }
}
