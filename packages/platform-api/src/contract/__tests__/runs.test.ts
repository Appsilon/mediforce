import { describe, it, expect } from 'vitest';
import { GetRunInputSchema, GetRunOutputSchema, ListRunNamesInputSchema, ListRunNamesOutputSchema } from '../runs';

describe('GetRunInputSchema', () => {
  it('accepts a non-empty runId', () => {
    const result = GetRunInputSchema.safeParse({ runId: 'run-1' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty runId', () => {
    const result = GetRunInputSchema.safeParse({ runId: '' });
    expect(result.success).toBe(false);
  });
});

describe('GetRunOutputSchema', () => {
  it('accepts a fully populated terminal run', () => {
    const result = GetRunOutputSchema.safeParse({
      runId: 'run-1',
      status: 'completed',
      currentStepId: 'last-step',
      error: null,
      finalOutput: { ok: true },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a still-running response with null finalOutput', () => {
    const result = GetRunOutputSchema.safeParse({
      runId: 'run-2',
      status: 'running',
      currentStepId: 'step-3',
      error: null,
      finalOutput: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a failed run with an error message', () => {
    const result = GetRunOutputSchema.safeParse({
      runId: 'run-3',
      status: 'failed',
      currentStepId: null,
      error: 'boom',
      finalOutput: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown status', () => {
    const result = GetRunOutputSchema.safeParse({
      runId: 'run-4',
      status: 'magicked',
      currentStepId: null,
      error: null,
      finalOutput: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing runId', () => {
    const result = GetRunOutputSchema.safeParse({
      status: 'running',
      currentStepId: null,
      error: null,
      finalOutput: null,
    });
    expect(result.success).toBe(false);
  });
});

describe('ListRunNamesInputSchema', () => {
  it('accepts a non-empty namespace', () => {
    const result = ListRunNamesInputSchema.safeParse({ namespace: 'alpha' });
    expect(result.success).toBe(true);
  });

  it('rejects a missing namespace (always per-workspace)', () => {
    const result = ListRunNamesInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects an empty namespace', () => {
    const result = ListRunNamesInputSchema.safeParse({ namespace: '' });
    expect(result.success).toBe(false);
  });
});

describe('ListRunNamesOutputSchema', () => {
  it('accepts an array of projected entries', () => {
    const result = ListRunNamesOutputSchema.safeParse({
      runs: [{ id: 'r1', definitionName: 'wf' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an entry missing definitionName (fail loud)', () => {
    const result = ListRunNamesOutputSchema.safeParse({ runs: [{ id: 'r1' }] });
    expect(result.success).toBe(false);
  });
});
