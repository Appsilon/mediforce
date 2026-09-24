import { describe, it, expect } from 'vitest';
import type { CallerScope } from '../../../../repositories/index';
import { loadModelPrices } from '../model-prices';
import { evaluationFixture } from '../../__tests__/fixture';

async function scopeWithPrices(prices: Record<string, { input: number; output: number }>): Promise<CallerScope> {
  const scope = (await evaluationFixture()).scope();
  Object.assign(scope, {
    models: { list: async () => Object.entries(prices).map(([id, pricing]) => ({ id, pricing })) },
  });
  return scope;
}

describe('loadModelPrices', () => {
  it('prices tokens at the registry rate of the model', async () => {
    const price = await loadModelPrices(await scopeWithPrices({ 'judge/model': { input: 0.001, output: 0.002 } }));

    expect(price('judge/model', { inputTokens: 1000, outputTokens: 500 })).toBeCloseTo(2);
  });

  it('returns null for a model the registry does not price', async () => {
    const price = await loadModelPrices(await scopeWithPrices({ 'judge/model': { input: 0.001, output: 0.002 } }));

    expect(price('other/model', { inputTokens: 1, outputTokens: 1 })).toBeNull();
    expect(price(undefined, { inputTokens: 1, outputTokens: 1 })).toBeNull();
  });
});
