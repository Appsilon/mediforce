import { describe, expect, it } from 'vitest';
import { ACTIONABLE_STATUSES, ListTasksInputSchema } from '../../../contract/tasks';

/**
 * Contract-only tests: exercise the non-trivial bits of the Zod schema —
 * `refine()` rules, exported literal constants. Plain Zod field validation
 * (`.min(1)`, `required`, enum value matching, nested validation) is Zod's
 * own contract; we don't re-test it here.
 */

describe('ListTasksInputSchema — filter exclusivity (instanceId vs role)', () => {
  it('accepts instanceId alone', () => {
    expect(ListTasksInputSchema.safeParse({ instanceId: 'inst-1' }).success).toBe(true);
  });

  it('accepts role alone', () => {
    expect(ListTasksInputSchema.safeParse({ role: 'reviewer' }).success).toBe(true);
  });

  it('accepts empty input — caller-scope axis (GitHub-like default)', () => {
    expect(ListTasksInputSchema.safeParse({}).success).toBe(true);
  });

  it('rejects when both instanceId and role are provided', () => {
    const result = ListTasksInputSchema.safeParse({ instanceId: 'inst-1', role: 'reviewer' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/mutually exclusive/i);
    }
  });
});

describe('ListTasksInputSchema — stepId / status narrowing', () => {
  // No "stepId requires instanceId" refine: `role + stepId` is a valid
  // cross-instance bottleneck view, and `stepId` alone now combines with
  // the caller-scope axis (every step `step-a` task across the caller's
  // workspaces).

  it('accepts instanceId + stepId (next-step-card pattern)', () => {
    expect(ListTasksInputSchema.safeParse({ instanceId: 'inst-1', stepId: 'step-a' }).success).toBe(true);
  });

  it('accepts role + stepId (cross-instance step inspection)', () => {
    expect(ListTasksInputSchema.safeParse({ role: 'reviewer', stepId: 'step-a' }).success).toBe(true);
  });

  it('accepts instanceId + stepId + status (full narrowing)', () => {
    expect(
      ListTasksInputSchema.safeParse({
        instanceId: 'inst-1',
        stepId: 'step-a',
        status: ['pending'],
      }).success,
    ).toBe(true);
  });

  it('accepts stepId alone (caller-scope axis + stepId filter)', () => {
    expect(ListTasksInputSchema.safeParse({ stepId: 'step-a' }).success).toBe(true);
  });

  it('accepts status alone (caller-scope axis + status filter — "my actionable queue")', () => {
    expect(ListTasksInputSchema.safeParse({ status: ['pending'] }).success).toBe(true);
  });
});

describe('ACTIONABLE_STATUSES', () => {
  it('is [pending, claimed]', () => {
    expect([...ACTIONABLE_STATUSES]).toEqual(['pending', 'claimed']);
  });

  it('is accepted by the input schema as a status filter (catches enum drift)', () => {
    expect(ListTasksInputSchema.safeParse({ role: 'reviewer', status: ACTIONABLE_STATUSES }).success).toBe(true);
  });
});
