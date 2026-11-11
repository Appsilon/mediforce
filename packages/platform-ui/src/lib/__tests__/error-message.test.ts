import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { errorMessage } from '../error-message';

describe('errorMessage', () => {
  it('turns a blank required field into a plain sentence, not the raw Zod issues', () => {
    const result = z.object({ name: z.string().min(1) }).safeParse({ name: '' });
    expect(result.success).toBe(false);
    expect(errorMessage(result.error)).toBe('"name" is required.');
  });

  it('keeps a non-blank validation message, with the field named', () => {
    const result = z.object({ age: z.number().min(18) }).safeParse({ age: 5 });
    expect(result.success).toBe(false);
    expect(errorMessage(result.error)).toContain('"age"');
    expect(errorMessage(result.error)).not.toContain('{');
  });

  it('passes through a normal Error message', () => {
    expect(errorMessage(new Error('Agent not found'))).toBe('Agent not found');
  });

  it('falls back for a non-Error value', () => {
    expect(errorMessage('boom', 'Something went wrong.')).toBe('Something went wrong.');
  });
});
