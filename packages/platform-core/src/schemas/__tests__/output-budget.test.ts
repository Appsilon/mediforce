import { describe, expect, it } from 'vitest';
import { resolveMaxOutputTokens } from '../output-budget';

describe('resolveMaxOutputTokens', () => {
  it('sends the default unchanged when nothing is set, whatever the model limit', () => {
    expect(resolveMaxOutputTokens({ defaultTokens: 16_384 })).toBe(16_384);
    expect(resolveMaxOutputTokens({ defaultTokens: 16_384, modelMaxCompletionTokens: 8_192 })).toBe(16_384);
  });

  it('lowers the default for a low budget', () => {
    expect(resolveMaxOutputTokens({ defaultTokens: 16_000, budget: 'low' })).toBe(8_000);
    expect(resolveMaxOutputTokens({ defaultTokens: 8_000, budget: 'low' })).toBe(4_000);
  });

  it('raises the default up to the model limit for a higher budget', () => {
    expect(resolveMaxOutputTokens({ defaultTokens: 16_000, budget: 'high', modelMaxCompletionTokens: 64_000 })).toBe(32_000);
    expect(resolveMaxOutputTokens({ defaultTokens: 16_000, budget: 'max', modelMaxCompletionTokens: 32_768 })).toBe(32_768);
  });

  it('never drops below the default when raising on a model with a lower limit', () => {
    expect(resolveMaxOutputTokens({ defaultTokens: 16_384, budget: 'high', modelMaxCompletionTokens: 8_192 })).toBe(16_384);
  });

  it('does not raise when the model limit is unknown', () => {
    expect(resolveMaxOutputTokens({ defaultTokens: 16_000, budget: 'max', modelMaxCompletionTokens: null })).toBe(16_000);
    expect(resolveMaxOutputTokens({ defaultTokens: 16_000, budget: 'high' })).toBe(16_000);
  });

  it('caps every budget at the model limit when asked', () => {
    expect(resolveMaxOutputTokens({ defaultTokens: 16_000, modelMaxCompletionTokens: 8_192, capAtModelLimit: true })).toBe(8_192);
    expect(
      resolveMaxOutputTokens({ defaultTokens: 16_000, budget: 'high', modelMaxCompletionTokens: 20_000, capAtModelLimit: true }),
    ).toBe(20_000);
    expect(resolveMaxOutputTokens({ defaultTokens: 16_000, budget: 'low', capAtModelLimit: true })).toBe(8_000);
  });
});
