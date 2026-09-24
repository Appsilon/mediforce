import type {
  EvalRunEstimate,
  EvalRunEvaluator,
  EvalVariant,
  EvaluatedStep,
  EvaluatorVersion,
  WorkflowStep,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { loadModelPrices, type TokenCount } from './model-prices';
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

/** What each of the Step's recent production runs cost and used, from what its execution recorded. */
async function historicalUsage(scope: CallerScope, step: EvaluatedStep): Promise<{ costs: number[]; tokens: TokenCount[] }> {
  const costs: number[] = [];
  const tokens: TokenCount[] = [];
  for (const agentRun of await listStepProductionAgentRuns(scope, step, HISTORY_SAMPLE)) {
    const executions = await scope.runs.getStepExecutions(agentRun.processInstanceId);
    const execution = executions
      .filter((candidate) => candidate.stepId === step.stepId && candidate.startedAt <= agentRun.startedAt)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
    const cost = execution?.agentOutput?.estimatedCostUsd;
    if (typeof cost === 'number') costs.push(cost);
    const usage = execution?.agentOutput?.tokenUsage;
    if (usage !== undefined) tokens.push({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
  }
  return { costs, tokens };
}

/**
 * The pre-run estimate (ADR-0023 Consequences), per variant and in total. Per
 * trial of the champion — and of a challenger on the same model — the Step's
 * mean historical cost, or its model's registry price for a nominal turn when
 * it has no history. A challenger on another model is that model's price for
 * the tokens the Step's runs used, or a nominal turn. Every variant adds one
 * judge call per `llm_judge` Evaluator.
 */
export async function estimateEvalRun(
  scope: CallerScope,
  step: EvaluatedStep,
  workflowStep: WorkflowStep,
  evaluators: ReadonlyArray<{ frozen: EvalRunEvaluator; version: EvaluatorVersion }>,
  variants: ReadonlyArray<Pick<EvalVariant, 'id' | 'patch'>>,
  trialsPerVariant: number,
): Promise<EvalRunEstimate> {
  const { costs, tokens } = await historicalUsage(scope, step);
  const priceOf = await loadModelPrices(scope);
  const agent = workflowStep.agentId === undefined ? null : await scope.agentDefinitions.getById(workflowStep.agentId);
  const championModel = workflowStep.agent?.model ?? agent?.foundationModel;
  const typicalTokens = tokens.length === 0 ? NOMINAL_AGENT_TOKENS : {
    inputTokens: mean(tokens.map((usage) => usage.inputTokens)),
    outputTokens: mean(tokens.map((usage) => usage.outputTokens)),
  };

  let judgeCost = 0;
  for (const { version } of evaluators) {
    if (version.check.kind !== 'llm_judge') continue;
    judgeCost += priceOf(version.check.model, NOMINAL_JUDGE_TOKENS) ?? 0;
  }

  const agentCost = (model: string | undefined): { cost: number | null; basis: EvalRunEstimate['basis'] } => {
    if (model === championModel) {
      if (costs.length > 0) return { cost: mean(costs), basis: 'history' };
      const cost = priceOf(model, NOMINAL_AGENT_TOKENS);
      return { cost, basis: cost === null ? 'unknown' : 'model_pricing' };
    }
    const cost = priceOf(model, typicalTokens);
    return { cost, basis: cost === null ? 'unknown' : 'model_pricing' };
  };
  const perVariant = variants.map((variant) => {
    const { cost, basis } = agentCost(variant.patch.model ?? championModel);
    return { variantId: variant.id, perTrialUsd: cost === null ? null : round(cost + judgeCost), basis };
  });

  const known = perVariant.flatMap((variant) => (variant.perTrialUsd === null ? [] : [variant.perTrialUsd]));
  const totalUsd = known.length === perVariant.length ? round(known.reduce((sum, cost) => sum + cost, 0) * trialsPerVariant) : null;
  return {
    perTrialUsd: totalUsd === null ? null : round(totalUsd / (trialsPerVariant * perVariant.length)),
    totalUsd,
    basis: perVariant[0]?.basis ?? 'unknown',
    sampleSize: costs.length,
    variants: perVariant,
  };
}
