import { describe, it, expect } from 'vitest';
import type { AgentOutputEnvelope } from '@mediforce/platform-core';
import { agentOutputFromEnvelope } from '../agent-output-from-envelope';

function buildEnvelope(overrides: Partial<AgentOutputEnvelope> = {}): AgentOutputEnvelope {
  return {
    confidence: 0.9,
    reasoning_summary: 'looks good',
    reasoning_chain: [],
    annotations: [],
    model: 'claude-sonnet-4-5',
    duration_ms: 1234,
    result: { ok: true },
    ...overrides,
  };
}

describe('agentOutputFromEnvelope', () => {
  it('maps confidence, reasoning, result, model, duration', () => {
    const envelope = buildEnvelope({
      confidence: 0.42,
      confidence_rationale: 'mid certainty',
      reasoning_summary: 'because reasons',
      model: 'gpt-5',
      duration_ms: 5000,
      result: { foo: 'bar' },
    });

    const out = agentOutputFromEnvelope(envelope);

    expect(out.confidence).toBe(0.42);
    expect(out.confidence_rationale).toBe('mid certainty');
    expect(out.reasoning).toBe('because reasons');
    expect(out.model).toBe('gpt-5');
    expect(out.duration_ms).toBe(5000);
    expect(out.result).toEqual({ foo: 'bar' });
  });

  it('passes git metadata and presentation through', () => {
    const git = {
      commitSha: 'deadbeef',
      branch: 'feat/x',
      changedFiles: ['a.ts', 'b.ts'],
      repoUrl: 'https://github.com/org/repo',
    };
    const envelope = buildEnvelope({
      gitMetadata: git,
      presentation: '<div>html</div>',
    });

    const out = agentOutputFromEnvelope(envelope);

    expect(out.gitMetadata).toEqual(git);
    expect(out.presentation).toBe('<div>html</div>');
  });

  it('passes tokenUsage through', () => {
    const envelope = buildEnvelope({
      tokenUsage: { inputTokens: 100, outputTokens: 200 },
    });

    const out = agentOutputFromEnvelope(envelope);

    expect(out.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 200 });
  });

  it('returns null tokenUsage when envelope omits it', () => {
    const out = agentOutputFromEnvelope(buildEnvelope());
    expect(out.tokenUsage).toBeNull();
  });

  it('returns null estimatedCostUsd — envelope schema does not carry cost', () => {
    const out = agentOutputFromEnvelope(
      buildEnvelope({ tokenUsage: { inputTokens: 10, outputTokens: 20 } }),
    );
    expect(out.estimatedCostUsd).toBeNull();
  });

  it('always returns null escalationReason — envelope has no escalation field', () => {
    const out = agentOutputFromEnvelope(buildEnvelope());
    expect(out.escalationReason).toBeNull();
  });

  it('falls back to null for missing optional fields', () => {
    const out = agentOutputFromEnvelope(buildEnvelope());

    expect(out.confidence_rationale).toBeNull();
    expect(out.gitMetadata).toBeNull();
    expect(out.presentation).toBeNull();
  });
});
