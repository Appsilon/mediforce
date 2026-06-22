import { describe, it, expect } from 'vitest';
import { calculateEstimatedCost } from '../cost';

describe('calculateEstimatedCost', () => {
  it('multiplies tokens by per-token pricing', () => {
    const result = calculateEstimatedCost(
      { inputTokens: 1000, outputTokens: 500 },
      { input: 0.000003, output: 0.000015 },
    );
    // 1000 * 0.000003 + 500 * 0.000015 = 0.003 + 0.0075 = 0.0105
    expect(result).toBeCloseTo(0.0105);
  });

  it('returns 0 when tokens are 0', () => {
    const result = calculateEstimatedCost({ inputTokens: 0, outputTokens: 0 }, { input: 0.000003, output: 0.000015 });
    expect(result).toBe(0);
  });

  it('handles large token counts', () => {
    const result = calculateEstimatedCost(
      { inputTokens: 100_000, outputTokens: 50_000 },
      { input: 0.000003, output: 0.000015 },
    );
    // 100000 * 0.000003 + 50000 * 0.000015 = 0.3 + 0.75 = 1.05
    expect(result).toBeCloseTo(1.05);
  });

  it('prices cached input tokens at the cache-read rate', () => {
    const result = calculateEstimatedCost(
      { inputTokens: 1000, outputTokens: 500, cachedInputTokens: 8000 },
      { input: 0.000003, output: 0.000015, cacheRead: 0.0000003 },
    );
    // 1000*0.000003 + 8000*0.0000003 + 500*0.000015 = 0.003 + 0.0024 + 0.0075
    expect(result).toBeCloseTo(0.0129);
  });

  it('falls back to the input rate for cached tokens when cacheRead is absent', () => {
    const result = calculateEstimatedCost(
      { inputTokens: 1000, outputTokens: 0, cachedInputTokens: 2000 },
      { input: 0.000003, output: 0.000015 },
    );
    // (1000 + 2000) * 0.000003 = 0.009
    expect(result).toBeCloseTo(0.009);
  });
});
