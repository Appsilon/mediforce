import {
  evaluatorTrust,
  type EvaluatedStep,
  type Evaluator,
  type EvaluatorVersion,
} from '@mediforce/platform-core';
import type { AgentOutputGate, AgentOutputGateVerdict } from '@mediforce/agent-runtime';
import type { CallerScope } from '../../../repositories/index';
import { recordScore } from '../../scores/record-score';
import { evaluatorProduction } from './evaluator-view';
import type { EvaluationSubject } from './evaluation-subject';
import { loadModelPrices } from './model-prices';
import { runEvaluatorCheck, type JudgeUsage } from './run-evaluator-check';

interface ProductionEvaluator {
  readonly evaluator: Evaluator;
  readonly version: EvaluatorVersion;
}

/** The step's Evaluators that score live runs now: flagged, not archived, latest version counted (D9, D13). */
export async function listProductionEvaluators(scope: CallerScope, step: EvaluatedStep): Promise<ProductionEvaluator[]> {
  const flagged = (await scope.evaluation.listEvaluators(step))
    .filter((evaluator) => evaluator.runInProduction === true && evaluator.archived === false);
  const active: ProductionEvaluator[] = [];
  for (const evaluator of flagged) {
    const versions = await scope.evaluation.listEvaluatorVersions(evaluator.id);
    const version = versions[versions.length - 1];
    if (version === undefined) continue;
    if (evaluatorProduction(evaluator, evaluatorTrust(version)).active === true) active.push({ evaluator, version });
  }
  return active;
}

/** Whether the step has any Evaluator marked for production, counted or not — one cheap query for the runner to skip the gate. */
export async function hasProductionEvaluators(scope: CallerScope, step: EvaluatedStep): Promise<boolean> {
  return (await scope.evaluation.listEvaluators(step))
    .some((evaluator) => evaluator.runInProduction === true && evaluator.archived === false);
}

export interface ProductionScoring {
  readonly verdict: AgentOutputGateVerdict;
  /** The asynchronous `llm_judge` scorings; they never block or fail the step. */
  readonly judges: Promise<void>[];
}

async function scoreProduction(
  scope: CallerScope,
  subject: EvaluationSubject,
  { evaluator, version }: ProductionEvaluator,
  judgeUsages: readonly JudgeUsage[],
  priceOf: Awaited<ReturnType<typeof loadModelPrices>>,
  outcome: Awaited<ReturnType<typeof runEvaluatorCheck>>,
): Promise<void> {
  if (outcome.passed === null || outcome.value === null) return;
  const costs = judgeUsages.map((usage) =>
    priceOf(usage.model, { inputTokens: usage.promptTokens, outputTokens: usage.completionTokens }));
  const judgeCostUsd = costs.reduce<number>((sum, price) => sum + (price ?? 0), 0);
  await recordScore({
    subject: { type: 'agent_run', id: subject.agentRun.id },
    name: evaluator.name,
    value: outcome.value,
    label: outcome.label,
    comment: outcome.comment,
    source: version.check.kind === 'llm_judge' ? 'llm_judge' : 'deterministic',
    createdBy: null,
    metadata: {
      production: true,
      evaluatorVersion: version.version,
      counted: true,
      ...(judgeUsages.length === 0 ? {} : { judgeCostUsd }),
    },
    namespace: subject.instance.namespace ?? evaluator.namespace,
    processInstanceId: subject.agentRun.processInstanceId,
    stepId: subject.agentRun.stepId,
    evaluatorId: evaluator.id,
    supersedes: null,
    basis: `Production Evaluator '${evaluator.name}' v${version.version} (ADR-0023 D13)`,
  }, scope);
}

/**
 * Scores one live Agent Run with the step's production Evaluators (D13).
 * `schema` and `code` run now, each writing a Score marked `production`; a
 * failing critical one is the verdict's `failure`. A check that cannot run is
 * an `error`, never a failure. `llm_judge` ones start and are returned in
 * `judges` — they only write Scores.
 */
export async function scoreProductionRun(
  scope: CallerScope,
  step: EvaluatedStep,
  subject: EvaluationSubject,
): Promise<ProductionScoring> {
  const evaluators = await listProductionEvaluators(scope, step);
  if (evaluators.length === 0) return { verdict: { failure: null, errors: [] }, judges: [] };

  const priceOf = await loadModelPrices(scope);
  const failures: string[] = [];
  const errors: string[] = [];
  const judges: Promise<void>[] = [];

  const run = async (candidate: ProductionEvaluator) => {
    const judgeUsages: JudgeUsage[] = [];
    const outcome = await runEvaluatorCheck(scope, candidate.version.check, subject, null, (usage) => judgeUsages.push(usage));
    await scoreProduction(scope, subject, candidate, judgeUsages, priceOf, outcome);
    return outcome;
  };

  for (const candidate of evaluators) {
    const { evaluator, version } = candidate;
    if (version.check.kind === 'llm_judge') {
      judges.push(run(candidate).then((outcome) => {
        if (outcome.error !== null) console.error(`[production-evaluator] '${evaluator.name}' could not run:`, outcome.error);
      }).catch((err) => {
        console.error(`[production-evaluator] '${evaluator.name}' failed:`, err);
      }));
      continue;
    }
    const outcome = await run(candidate);
    if (outcome.error !== null) {
      errors.push(`${evaluator.name}: ${outcome.error}`);
    } else if (outcome.passed === false && version.severity === 'critical') {
      failures.push(`Evaluator '${evaluator.name}' v${version.version} failed: ${outcome.comment ?? version.rule}`);
    }
  }
  return { verdict: { failure: failures.length === 0 ? null : failures.join('; '), errors }, judges };
}

/** The runner's output gate for a step with production Evaluators. */
export function productionEvaluatorGate(scope: CallerScope): AgentOutputGate {
  return async ({ agentRunId, context, envelope }) => {
    const agentRun = await scope.agentRuns.getById(agentRunId);
    const instance = await scope.runs.getById(context.processInstanceId);
    if (agentRun === null || instance === null) return { failure: null, errors: ['the Agent Run is not visible to the gate'] };
    const subject: EvaluationSubject = {
      agentRun: { ...agentRun, envelope },
      instance,
      stepInput: context.stepInput,
      trajectory: (await scope.agentTrajectories.list(agentRunId)) ?? [],
    };
    const step = { namespace: context.runNamespace, workflowName: context.workflowDefinition.name, stepId: context.stepId };
    return (await scoreProductionRun(scope, step, subject)).verdict;
  };
}
