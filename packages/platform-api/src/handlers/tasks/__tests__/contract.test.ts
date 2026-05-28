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

describe('ListTasksInputSchema — stepId narrowing (Phase 4 PR1 consumers)', () => {
  // The Phase 4 PRD §3 proposed a refine "stepId requires instanceId" but the
  // schema already allowed `role + stepId`. Per the PRD amendment recorded in
  // Phase 4 PR1: leave the schema permissive — no consumer needs the constraint
  // and `role + stepId` is a semantically valid cross-instance bottleneck view.

  it('accepts instanceId + stepId (next-step-card pattern)', () => {
    expect(
      ListTasksInputSchema.safeParse({ instanceId: 'inst-1', stepId: 'step-a' }).success,
    ).toBe(true);
  });

  it('accepts role + stepId (cross-instance step inspection, allowed by design)', () => {
    expect(
      ListTasksInputSchema.safeParse({ role: 'reviewer', stepId: 'step-a' }).success,
    ).toBe(true);
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

  it('rejects stepId alone (no axis — fails XOR refine)', () => {
    expect(ListTasksInputSchema.safeParse({ stepId: 'step-a' }).success).toBe(false);
  });

  it('rejects status alone (no axis — fails XOR refine)', () => {
    expect(ListTasksInputSchema.safeParse({ status: ['pending'] }).success).toBe(false);
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
