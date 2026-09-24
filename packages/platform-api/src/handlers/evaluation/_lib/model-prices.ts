import { calculateEstimatedCost } from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';

export interface TokenCount {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** What `tokens` cost on `model` at the registry's price; null for a model it does not price. */
export type ModelPrice = (model: string | undefined, tokens: TokenCount) => number | null;

/** The model registry's prices, read once. */
export async function loadModelPrices(scope: CallerScope): Promise<ModelPrice> {
  const models = await scope.models.list();
  return (model, tokens) => {
    const entry = model === undefined ? undefined : models.find((candidate) => candidate.id === model);
    return entry === undefined ? null : calculateEstimatedCost(tokens, entry.pricing);
  };
}
