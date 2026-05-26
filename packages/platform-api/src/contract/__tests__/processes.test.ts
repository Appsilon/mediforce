import { describe, it, expect } from 'vitest';
import { CancelRunInputSchema } from '../processes.js';

describe('CancelRunInputSchema', () => {
  it('accepts a non-empty runId without reason', () => {
    const result = CancelRunInputSchema.safeParse({ runId: 'inst-1' });
    expect(result.success).toBe(true);
  });

  it('accepts a runId with an explicit reason', () => {
    const result = CancelRunInputSchema.safeParse({
      runId: 'inst-1',
      reason: 'Operator-requested cleanup',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty runId', () => {
    const result = CancelRunInputSchema.safeParse({ runId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string reason (use omission instead for default)', () => {
    const result = CancelRunInputSchema.safeParse({
      runId: 'inst-1',
      reason: '',
    });
    expect(result.success).toBe(false);
  });
});
