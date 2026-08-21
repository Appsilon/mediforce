import { describe, it, expect } from 'vitest';
import { buildAgentRun, buildAgentOutputEnvelope } from '@mediforce/platform-core/testing';
import { formatAgentRunCost, type ModelPricing } from '../agent-cost';

const PRICING = new Map<string, ModelPricing>([
  ['anthropic/claude-sonnet-4', { input: 0.000003, output: 0.000015 }],
  ['free/local-model', { input: 0, output: 0 }],
]);

describe('formatAgentRunCost', () => {
  it('[DATA] returns "no data" when the run has no envelope', () => {
    const run = buildAgentRun({ envelope: null });
    expect(formatAgentRunCost(run, PRICING)).toBe('no data');
  });

  it('[DATA] returns "no data" when the envelope has no token usage', () => {
    const run = buildAgentRun({ envelope: buildAgentOutputEnvelope({ tokenUsage: undefined }) });
    expect(formatAgentRunCost(run, PRICING)).toBe('no data');
  });

  it('[DATA] returns "no data" when the envelope has no model', () => {
    const run = buildAgentRun({
      envelope: buildAgentOutputEnvelope({
        model: null,
        tokenUsage: { inputTokens: 1000, outputTokens: 500 },
      }),
    });
    expect(formatAgentRunCost(run, PRICING)).toBe('no data');
  });

  it('[DATA] returns "no data" when the model is not in the pricing map', () => {
    const run = buildAgentRun({
      envelope: buildAgentOutputEnvelope({
        model: 'unknown/model',
        tokenUsage: { inputTokens: 1000, outputTokens: 500 },
      }),
    });
    expect(formatAgentRunCost(run, PRICING)).toBe('no data');
  });

  it('[DATA] formats a computed non-zero cost', () => {
    const run = buildAgentRun({
      envelope: buildAgentOutputEnvelope({
        model: 'anthropic/claude-sonnet-4',
        tokenUsage: { inputTokens: 100_000, outputTokens: 10_000 },
      }),
    });
    // 100_000 * 0.000003 + 10_000 * 0.000015 = 0.3 + 0.15 = 0.45
    expect(formatAgentRunCost(run, PRICING)).toBe('$0.450');
  });

  it('[DATA] displays "$0.00" for a genuinely zero cost, not "no data"', () => {
    const run = buildAgentRun({
      envelope: buildAgentOutputEnvelope({
        model: 'free/local-model',
        tokenUsage: { inputTokens: 100_000, outputTokens: 10_000 },
      }),
    });
    expect(formatAgentRunCost(run, PRICING)).toBe('$0.00');
  });
});
