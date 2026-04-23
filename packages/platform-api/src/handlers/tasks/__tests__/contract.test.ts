import { describe, expect, it } from 'vitest';
import {
  ACTIONABLE_STATUSES,
  ListTasksInputSchema,
  ListTasksOutputSchema,
} from '../../../contract/tasks.js';

/**
 * Contract-only tests: exercise the Zod schemas directly. No handler, no repo.
 * These lock the shape of the API boundary — UI and agents rely on them.
 */

describe('ListTasksInputSchema', () => {
  describe('filter exclusivity (instanceId XOR role)', () => {
    it('accepts instanceId alone', () => {
      const result = ListTasksInputSchema.safeParse({ instanceId: 'inst-1' });
      expect(result.success).toBe(true);
    });

    it('accepts role alone', () => {
      const result = ListTasksInputSchema.safeParse({ role: 'reviewer' });
      expect(result.success).toBe(true);
    });

    it('rejects when neither is provided', () => {
      const result = ListTasksInputSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toMatch(/exactly one of/i);
      }
    });

    it('rejects when both instanceId and role are provided', () => {
      const result = ListTasksInputSchema.safeParse({
        instanceId: 'inst-1',
        role: 'reviewer',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('status filter (array)', () => {
    it('accepts a single-element status array', () => {
      const result = ListTasksInputSchema.safeParse({
        role: 'reviewer',
        status: ['pending'],
      });
      expect(result.success).toBe(true);
    });

    it('accepts a multi-status array (the "actionable" use case)', () => {
      const result = ListTasksInputSchema.safeParse({
        role: 'reviewer',
        status: ['pending', 'claimed'],
      });
      expect(result.success).toBe(true);
    });

    it('accepts every status enum value', () => {
      const result = ListTasksInputSchema.safeParse({
        role: 'reviewer',
        status: ['pending', 'claimed', 'completed', 'cancelled'],
      });
      expect(result.success).toBe(true);
    });

    it('rejects an empty status array', () => {
      const result = ListTasksInputSchema.safeParse({
        role: 'reviewer',
        status: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects unknown status values inside the array', () => {
      const result = ListTasksInputSchema.safeParse({
        role: 'reviewer',
        status: ['pending', 'in_progress'],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('stepId filter', () => {
    it('accepts instanceId + stepId', () => {
      const result = ListTasksInputSchema.safeParse({
        instanceId: 'inst-1',
        stepId: 'review-step',
      });
      expect(result.success).toBe(true);
    });

    it('accepts role + stepId', () => {
      const result = ListTasksInputSchema.safeParse({
        role: 'reviewer',
        stepId: 'review-step',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty-string stepId', () => {
      const result = ListTasksInputSchema.safeParse({
        instanceId: 'inst-1',
        stepId: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('field-level validation', () => {
    it('rejects empty-string instanceId', () => {
      const result = ListTasksInputSchema.safeParse({ instanceId: '' });
      expect(result.success).toBe(false);
    });

    it('rejects empty-string role', () => {
      const result = ListTasksInputSchema.safeParse({ role: '' });
      expect(result.success).toBe(false);
    });
  });
});

describe('ACTIONABLE_STATUSES', () => {
  it('is [pending, claimed]', () => {
    expect([...ACTIONABLE_STATUSES]).toEqual(['pending', 'claimed']);
  });

  it('is accepted by the input schema as a status filter', () => {
    const result = ListTasksInputSchema.safeParse({
      role: 'reviewer',
      status: ACTIONABLE_STATUSES,
    });
    expect(result.success).toBe(true);
  });
});

describe('ListTasksOutputSchema', () => {
  it('accepts an empty tasks array', () => {
    const result = ListTasksOutputSchema.safeParse({ tasks: [] });
    expect(result.success).toBe(true);
  });

  it('rejects payloads missing the tasks field', () => {
    const result = ListTasksOutputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects tasks that miss required fields', () => {
    const result = ListTasksOutputSchema.safeParse({
      tasks: [{ id: 'task-1' }],
    });
    expect(result.success).toBe(false);
  });
});
