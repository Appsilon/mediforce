import { z } from 'zod';

/**
 * How much an LLM may write per platform call. `low`, `default` and `high` scale
 * each call's built-in max output tokens; `max` gives the model its own limit. A
 * workspace sets one; a member may override it, up or down, for the calls they
 * start. `default` is today's behaviour.
 */
export const OutputBudgetSchema = z.enum(['low', 'default', 'high', 'max']);
export type OutputBudget = z.infer<typeof OutputBudgetSchema>;

export const OUTPUT_BUDGETS = OutputBudgetSchema.options;

const OUTPUT_BUDGET_MULTIPLIERS: Record<Exclude<OutputBudget, 'max'>, number> = {
  low: 0.5,
  default: 1,
  high: 2,
};

/** Each platform LLM call's max output tokens at the `default` budget. */
export const OUTPUT_TOKEN_DEFAULTS = {
  evaluationJudge: 16_000,
  assistant: 8_000,
  agentAssistant: 4_000,
  coworkChat: 16_384,
  voiceSynthesis: 4_096,
} as const;

/**
 * Max output tokens for one call. At or below `default` the scaled value is sent
 * as is, so an unset workspace sends exactly what it always has. `high` doubles
 * it up to the model's own limit; `max` is that limit. A raise never goes below
 * the call's default, and is not taken at all when the registry doesn't know the
 * model's limit. `capAtModelLimit` caps every budget, for a call that has always
 * been capped (the eval judge). `raiseOnly` keeps `low` at the default, for a
 * short fixed-shape reply that a smaller limit would only cut off.
 */
export function resolveMaxOutputTokens(input: {
  defaultTokens: number;
  /** The caller's effective budget (`effectiveModelSettings`); `default` when absent. */
  budget?: OutputBudget;
  modelMaxCompletionTokens?: number | null;
  capAtModelLimit?: boolean;
  raiseOnly?: boolean;
}): number {
  const asked = input.budget ?? 'default';
  const budget = input.raiseOnly === true && asked === 'low' ? 'default' : asked;
  const modelLimit = input.modelMaxCompletionTokens ?? 0;
  const knowsModelLimit = modelLimit > 0;

  let tokens: number;
  if (budget === 'low' || budget === 'default') {
    tokens = Math.round(input.defaultTokens * OUTPUT_BUDGET_MULTIPLIERS[budget]);
  } else if (knowsModelLimit === false) {
    tokens = input.defaultTokens;
  } else {
    const raised = budget === 'max' ? modelLimit : Math.min(input.defaultTokens * OUTPUT_BUDGET_MULTIPLIERS.high, modelLimit);
    tokens = Math.max(input.defaultTokens, raised);
  }
  if (input.capAtModelLimit === true && knowsModelLimit) tokens = Math.min(tokens, modelLimit);
  return tokens;
}
