import { describe, expect, it } from 'vitest';
import {
  ACTIONABLE_STATUSES,
  ListTasksInputSchema,
} from '../../../contract/tasks.js';

/**
 * Contract-only tests: exercise the non-trivial bits of the Zod schema —
 * `refine()` rules, exported literal constants. Plain Zod field validation
 * (`.min(1)`, `required`, enum value matching, nested validation) is Zod's
 * own contract; we don't re-test it here.
 */

describe('ListTasksInputSchema — filter exclusivity refine (instanceId XOR role)', () => {
  it('accepts instanceId alone', () => {
    expect(ListTasksInputSchema.safeParse({ instanceId: 'inst-1' }).success).toBe(true);
  });

  it('accepts role alone', () => {
    expect(ListTasksInputSchema.safeParse({ role: 'reviewer' }).success).toBe(true);
  });

  it('rejects when neither is provided', () => {
    const result = ListTasksInputSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/exactly one of/i);
    }
  });

  it('rejects when both instanceId and role are provided', () => {
    expect(
      ListTasksInputSchema.safeParse({ instanceId: 'inst-1', role: 'reviewer' }).success,
    ).toBe(false);
  });
});

describe('ACTIONABLE_STATUSES', () => {
  it('is [pending, claimed]', () => {
    expect([...ACTIONABLE_STATUSES]).toEqual(['pending', 'claimed']);
  });

  it('is accepted by the input schema as a status filter (catches enum drift)', () => {
    expect(
      ListTasksInputSchema.safeParse({ role: 'reviewer', status: ACTIONABLE_STATUSES }).success,
    ).toBe(true);
  });
});
