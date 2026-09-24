import type { EvalRunEstimate, EvalRunEvaluator, EvaluatedStep, EvaluatorVersion, WorkflowStep } from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { loadModelPrices } from './model-prices';
import { listStepProductionAgentRuns } from './step-agent-runs';

/** A nominal agent turn budget, for when the Step has no cost history. */
const NOMINAL_AGENT_TOKENS = { inputTokens: 50_000, outputTokens: 5_000 };
/** What one judge call costs, roughly: the output and rubric in, the reasoning out. */
const NOMINAL_JUDGE_TOKENS = { inputTokens: 4_000, outputTokens: 500 };
const HISTORY_SAMPLE = 20;

function round(usd: number): number {
  return Math.round(usd * 10_000) / 10_000;
}

/** Mean cost of the Step's recent production runs, from what each execution recorded. */
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
 * The pre-run estimate (ADR-0023 Consequences): per trial, the Step's mean
 * historical cost — or its model's registry price for a nominal turn when it
 * has no history — plus one judge call per `llm_judge` Evaluator.
 */
export async function estimateEvalRun(
  scope: CallerScope,
  step: EvaluatedStep,
  workflowStep: WorkflowStep,
  evaluators: ReadonlyArray<{ frozen: EvalRunEvaluator; version: EvaluatorVersion }>,
  trialCount: number,
): Promise<EvalRunEstimate> {
  const history = await historicalCosts(scope, step);
  const priceOf = await loadModelPrices(scope);
  let basis: EvalRunEstimate['basis'] = 'unknown';
  let agentCost: number | null = null;
  if (history.length > 0) {
    basis = 'history';
    agentCost = history.reduce((sum, cost) => sum + cost, 0) / history.length;
  } else {
    const agent = workflowStep.agentId === undefined ? null : await scope.agentDefinitions.getById(workflowStep.agentId);
    const model = workflowStep.agent?.model ?? agent?.foundationModel;
    agentCost = priceOf(model, NOMINAL_AGENT_TOKENS);
    if (agentCost !== null) basis = 'model_pricing';
  }
  if (agentCost === null) return { perTrialUsd: null, totalUsd: null, basis, sampleSize: 0 };

  let judgeCost = 0;
  for (const { version } of evaluators) {
    if (version.check.kind !== 'llm_judge') continue;
    judgeCost += priceOf(version.check.model, NOMINAL_JUDGE_TOKENS) ?? 0;
  }
  const perTrial = agentCost + judgeCost;
  return {
    perTrialUsd: round(perTrial),
    totalUsd: round(perTrial * trialCount),
    basis,
    sampleSize: history.length,
  };
}
