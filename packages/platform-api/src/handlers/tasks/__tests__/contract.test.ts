import { describe, expect, it } from 'vitest';
import {
  ACTIONABLE_STATUSES,
  ListTasksInputSchema,
} from '../../../contract/tasks';

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
    expect(
      ListTasksInputSchema.safeParse({ instanceId: 'inst-1', stepId: 'step-a' }).success,
    ).toBe(true);
  });

  it('accepts role + stepId (cross-instance step inspection)', () => {
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
    expect(
      ListTasksInputSchema.safeParse({ role: 'reviewer', status: ACTIONABLE_STATUSES }).success,
    ).toBe(true);
  });
});

/**
 * One schema serves two callers with different wire shapes: the client passes
 * a real boolean, the route adapter passes whatever the query string carried.
 * Both must land on the same post-parse `boolean`, or the fork
 * `ListRunsPageClientInputSchema` had to make would repeat here.
 */
describe('ListTasksInputSchema — actionable', () => {
  it('accepts a boolean, as the client sends it', () => {
    expect(ListTasksInputSchema.parse({ actionable: true }).actionable).toBe(true);
  });

  it("accepts the query string's 'true', as the route adapter sends it", () => {
    expect(ListTasksInputSchema.parse({ actionable: 'true' }).actionable).toBe(true);
  });

  it("parses 'false' to false rather than to a truthy string", () => {
    expect(ListTasksInputSchema.parse({ actionable: 'false' }).actionable).toBe(false);
  });

  it('leaves it undefined when absent — the unfiltered default', () => {
    expect(ListTasksInputSchema.parse({}).actionable).toBeUndefined();
  });

  it('rejects a value that is neither', () => {
    expect(ListTasksInputSchema.safeParse({ actionable: 'yes' }).success).toBe(false);
  });
});

/**
 * The workspace axis carries one value from a query string and many from the
 * inbox's multi-select, so one schema has to take both and hand the handler a
 * single shape.
 */
describe('ListTasksInputSchema — the namespace axis takes one or many', () => {
  it('normalises a bare string into a one-element list', () => {
    const parsed = ListTasksInputSchema.parse({ namespace: 'db' });
    expect(parsed.namespace).toEqual(['db']);
  });

  it('takes the list a multi-select produces unchanged', () => {
    const parsed = ListTasksInputSchema.parse({ namespace: ['db', 'empty'] });
    expect(parsed.namespace).toEqual(['db', 'empty']);
  });

  it('leaves it absent when the caller asks for every workspace', () => {
    const parsed = ListTasksInputSchema.parse({});
    expect(parsed.namespace).toBeUndefined();
  });

  it('rejects an empty selection — it has no answer the axis can give', () => {
    expect(() => ListTasksInputSchema.parse({ namespace: [] })).toThrow();
  });

  it('rejects an empty workspace name', () => {
    expect(() => ListTasksInputSchema.parse({ namespace: [''] })).toThrow();
  });
});
