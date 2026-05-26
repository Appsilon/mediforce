import { describe, it, expect } from 'vitest';
import { CancelProcessInputSchema } from '../processes.js';

describe('CancelProcessInputSchema', () => {
  it('accepts a non-empty instanceId without reason', () => {
    const result = CancelProcessInputSchema.safeParse({ instanceId: 'inst-1' });
    expect(result.success).toBe(true);
  });

  it('accepts an instanceId with an explicit reason', () => {
    const result = CancelProcessInputSchema.safeParse({
      instanceId: 'inst-1',
      reason: 'Operator-requested cleanup',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty instanceId', () => {
    const result = CancelProcessInputSchema.safeParse({ instanceId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string reason (use omission instead for default)', () => {
    const result = CancelProcessInputSchema.safeParse({
      instanceId: 'inst-1',
      reason: '',
    });
    expect(result.success).toBe(false);
  });
});
