import { describe, it, expect } from 'vitest';
import {
  ListAgentRunsInputSchema,
  ListAgentRunsOutputSchema,
  GetAgentRunInputSchema,
  GetAgentRunOutputSchema,
} from '../agent-runs';

describe('ListAgentRunsInputSchema', () => {
  it('accepts an empty input — limit is optional, handler picks the default', () => {
    const result = ListAgentRunsInputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBeUndefined();
  });

  it('coerces string limit from query params and caps at 200', () => {
    const ok = ListAgentRunsInputSchema.safeParse({ limit: '10' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.limit).toBe(10);

    const overCap = ListAgentRunsInputSchema.safeParse({ limit: 10_001 });
    expect(overCap.success).toBe(false);
  });

  it('rejects stepId without runId', () => {
    const result = ListAgentRunsInputSchema.safeParse({ stepId: 'step-x' });
    expect(result.success).toBe(false);
  });

  it('accepts stepId together with runId', () => {
    const result = ListAgentRunsInputSchema.safeParse({ runId: 'r-1', stepId: 'step-x' });
    expect(result.success).toBe(true);
  });

  it('accepts an opaque cursor', () => {
    const result = ListAgentRunsInputSchema.safeParse({ cursor: 'abc' });
    expect(result.success).toBe(true);
  });
});

describe('ListAgentRunsOutputSchema', () => {
  it('accepts an empty page', () => {
    expect(ListAgentRunsOutputSchema.safeParse({ runs: [] }).success).toBe(true);
  });

  it('accepts a page with a cursor and a representative run', () => {
    const result = ListAgentRunsOutputSchema.safeParse({
      runs: [
        {
          id: 'ar-1',
          processInstanceId: 'inst-1',
          stepId: 's-1',
          pluginId: 'risk-driver',
          autonomyLevel: 'L2',
          status: 'completed',
          envelope: null,
          fallbackReason: null,
          startedAt: '2026-05-28T10:00:00.000Z',
          completedAt: '2026-05-28T10:01:00.000Z',
        },
      ],
      nextCursor: 'token-x',
    });
    expect(result.success).toBe(true);
  });
});

describe('GetAgentRunInputSchema / GetAgentRunOutputSchema', () => {
  it('requires a non-empty agentRunId', () => {
    expect(GetAgentRunInputSchema.safeParse({ agentRunId: '' }).success).toBe(false);
    expect(GetAgentRunInputSchema.safeParse({ agentRunId: 'ar-1' }).success).toBe(true);
  });

  it('wraps the entity under `run`', () => {
    const result = GetAgentRunOutputSchema.safeParse({
      run: {
        id: 'ar-1',
        processInstanceId: 'inst-1',
        stepId: 's-1',
        pluginId: 'p',
        autonomyLevel: 'L0',
        status: 'running',
        envelope: null,
        fallbackReason: null,
        startedAt: '2026-05-28T10:00:00.000Z',
        completedAt: null,
      },
    });
    expect(result.success).toBe(true);
  });
});
