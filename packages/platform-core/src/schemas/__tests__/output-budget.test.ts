import { describe, expect, it } from 'vitest';
import { effectiveOutputBudget, resolveMaxOutputTokens } from '../output-budget';

describe('effectiveOutputBudget', () => {
  it('is default when nothing is set', () => {
    expect(effectiveOutputBudget(undefined, undefined)).toBe('default');
  });

  it('takes the member budget over the workspace budget, up or down', () => {
    expect(effectiveOutputBudget('high', 'low')).toBe('low');
    expect(effectiveOutputBudget('default', 'max')).toBe('max');
    expect(effectiveOutputBudget(undefined, 'high')).toBe('high');
  });

  it('falls back to the workspace budget when the member has none', () => {
    expect(effectiveOutputBudget('low', undefined)).toBe('low');
  });
});

describe('resolveMaxOutputTokens', () => {
  it('sends the default unchanged when nothing is set, whatever the model limit', () => {
    expect(resolveMaxOutputTokens({ defaultTokens: 16_384 })).toBe(16_384);
    expect(resolveMaxOutputTokens({ defaultTokens: 16_384, modelMaxCompletionTokens: 8_192 })).toBe(16_384);
  });

  it('lowers the default for a low budget', () => {
    expect(resolveMaxOutputTokens({ defaultTokens: 16_000, workspaceBudget: 'low' })).toBe(8_000);
    expect(resolveMaxOutputTokens({ defaultTokens: 8_000, workspaceBudget: 'high', memberBudget: 'low' })).toBe(4_000);
  });

  it('raises the default up to the model limit for a higher budget', () => {
    expect(resolveMaxOutputTokens({ defaultTokens: 16_000, workspaceBudget: 'high', modelMaxCompletionTokens: 64_000 })).toBe(32_000);
    expect(resolveMaxOutputTokens({ defaultTokens: 16_000, workspaceBudget: 'max', modelMaxCompletionTokens: 32_768 })).toBe(32_768);
  });

  it('never drops below the default when raising on a model with a lower limit', () => {
    expect(resolveMaxOutputTokens({ defaultTokens: 16_384, workspaceBudget: 'high', modelMaxCompletionTokens: 8_192 })).toBe(16_384);
  });

  it('does not raise when the model limit is unknown', () => {
    expect(resolveMaxOutputTokens({ defaultTokens: 16_000, workspaceBudget: 'max', modelMaxCompletionTokens: null })).toBe(16_000);
    expect(resolveMaxOutputTokens({ defaultTokens: 16_000, workspaceBudget: 'high' })).toBe(16_000);
  });

  it('caps every budget at the model limit when asked', () => {
    expect(resolveMaxOutputTokens({ defaultTokens: 16_000, modelMaxCompletionTokens: 8_192, capAtModelLimit: true })).toBe(8_192);
    expect(
      resolveMaxOutputTokens({ defaultTokens: 16_000, workspaceBudget: 'high', modelMaxCompletionTokens: 20_000, capAtModelLimit: true }),
    ).toBe(20_000);
    expect(resolveMaxOutputTokens({ defaultTokens: 16_000, workspaceBudget: 'low', capAtModelLimit: true })).toBe(8_000);
  });
});
