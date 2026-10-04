import type {
  EvalRunEstimate,
  EvalRunEvaluator,
  EvaluatedStep,
  EvaluatorVersion,
  WorkflowStep,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { loadModelPrices } from './model-prices';
import { listStepProductionAgentRuns } from './step-agent-runs';

/** A nominal agent turn budget, for when the Step has no token history. */
const NOMINAL_AGENT_TOKENS = { inputTokens: 50_000, outputTokens: 5_000 };
/** What one judge call costs, roughly: the output and rubric in, the reasoning out. */
const NOMINAL_JUDGE_TOKENS = { inputTokens: 4_000, outputTokens: 500 };
const HISTORY_SAMPLE = 20;

function round(usd: number): number {
  return Math.round(usd * 10_000) / 10_000;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** What each of the Step's recent production runs cost, from what its execution recorded. */
async function historicalCosts(scope: CallerScope, step: EvaluatedStep): Promise<number[]> {
  const costs: number[] = [];
  for (const agentRun of await listStepProductionAgentRuns(scope, step, HISTORY_SAMPLE)) {
    const executions = await scope.runs.getStepExecutions(agentRun.processInstanceId);
    const execution = executions
      .filter((candidate) => candidate.stepId === step.stepId && candidate.startedAt <= agentRun.startedAt)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
    const cost = execution?.agentOutput?.estimatedCostUsd;
    if (typeof cost === 'number') costs.push(cost);
  }
  return costs;
}

/**
 * The pre-run estimate (ADR-0023 Consequences). Per trial, the Step's mean
 * historical cost, or its model's registry price for a nominal turn when it
 * has no history, plus one judge call per `llm_judge` Evaluator and
 * `expected_output` check — for the latter an upper bound, since an exact
 * comparison calls no model.
 */
export async function estimateEvalRun(
  scope: CallerScope,
  step: EvaluatedStep,
  workflowStep: WorkflowStep,
  evaluators: ReadonlyArray<{ frozen: EvalRunEvaluator; version: EvaluatorVersion }>,
  trialCount: number,
): Promise<EvalRunEstimate> {
  const costs = await historicalCosts(scope, step);
  const priceOf = await loadModelPrices(scope);
  const agent = workflowStep.agentId === undefined ? null : await scope.agentDefinitions.getById(workflowStep.agentId);
  const model = workflowStep.agent?.model ?? agent?.foundationModel;

  let judgeCost = 0;
  for (const { version } of evaluators) {
    if (version.check.kind !== 'llm_judge' && version.check.kind !== 'expected_output') continue;
    judgeCost += priceOf(version.check.model, NOMINAL_JUDGE_TOKENS) ?? 0;
  }

  const agentCost = costs.length > 0 ? mean(costs) : priceOf(model, NOMINAL_AGENT_TOKENS);
  const basis: EvalRunEstimate['basis'] = costs.length > 0 ? 'history' : agentCost === null ? 'unknown' : 'model_pricing';
  const perTrialUsd = agentCost === null ? null : round(agentCost + judgeCost);
  return {
    perTrialUsd,
    totalUsd: perTrialUsd === null ? null : round(perTrialUsd * trialCount),
    basis,
    sampleSize: costs.length,
  };
}
