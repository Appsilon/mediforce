import { z } from 'zod';

/**
 * How much an LLM may write per platform call, as a step that scales each call's
 * built-in max output tokens. A workspace sets one; a member may override it, up
 * or down, for the calls they start. `default` is today's behaviour.
 */
export const OutputBudgetSchema = z.enum(['low', 'default', 'high', 'max']);
export type OutputBudget = z.infer<typeof OutputBudgetSchema>;

export const OUTPUT_BUDGETS = OutputBudgetSchema.options;

export const OUTPUT_BUDGET_MULTIPLIERS: Record<OutputBudget, number> = {
  low: 0.5,
  default: 1,
  high: 2,
  max: 4,
};

/** Each platform LLM call's max output tokens at the `default` budget. */
export const OUTPUT_TOKEN_DEFAULTS = {
  evaluationJudge: 16_000,
  assistant: 8_000,
  coworkChat: 16_384,
  voiceSynthesis: 4_096,
} as const;

/** A member's own budget overrides the workspace budget. */
export function effectiveOutputBudget(
  workspaceBudget: OutputBudget | undefined,
  memberBudget: OutputBudget | undefined,
): OutputBudget {
  return memberBudget ?? workspaceBudget ?? 'default';
}

export function scaleOutputTokens(defaultTokens: number, budget: OutputBudget): number {
  return Math.round(defaultTokens * OUTPUT_BUDGET_MULTIPLIERS[budget]);
}

/**
 * Max output tokens for one call. At or below `default` the scaled value is sent
 * as is, so an unset workspace sends exactly what it always has. Above `default`
 * the raise stops at the model's own limit, and is not taken at all when the
 * registry doesn't know that limit. `capAtModelLimit` caps every budget, for a
 * call that has always been capped (the eval judge).
 */
export function resolveMaxOutputTokens(input: {
  defaultTokens: number;
  workspaceBudget?: OutputBudget;
  memberBudget?: OutputBudget;
  modelMaxCompletionTokens?: number | null;
  capAtModelLimit?: boolean;
}): number {
  const budget = effectiveOutputBudget(input.workspaceBudget, input.memberBudget);
  const scaled = scaleOutputTokens(input.defaultTokens, budget);
  const modelLimit = input.modelMaxCompletionTokens ?? 0;
  const knowsModelLimit = modelLimit > 0;

  let tokens = scaled;
  if (OUTPUT_BUDGET_MULTIPLIERS[budget] > 1) {
    tokens = knowsModelLimit ? Math.max(input.defaultTokens, Math.min(scaled, modelLimit)) : input.defaultTokens;
  }
  if (input.capAtModelLimit === true && knowsModelLimit) tokens = Math.min(tokens, modelLimit);
  return tokens;
}
