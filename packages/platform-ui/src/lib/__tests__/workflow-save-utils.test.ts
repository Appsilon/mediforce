import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseWorkflowDefinitionForCreation } from '@mediforce/platform-core';
import type { WorkflowStep } from '@mediforce/platform-core';
import { ApiError } from '@mediforce/platform-api/client';
import { handleSaveFailure, validateSteps } from '../workflow-save-utils';

/**
 * Issues are produced by the real schema rather than hand-written strings:
 * hand-written Zod prose silently goes stale when Zod changes its wording,
 * which is exactly how the previous translation layer stopped matching.
 */
function issuesFor(input: Record<string, unknown>): unknown[] {
  const parsed = parseWorkflowDefinitionForCreation({ namespace: 'ns', ...input });
  if (parsed.success) throw new Error('expected the fixture to fail validation');
  return JSON.parse(JSON.stringify(parsed.error.issues)) as unknown[];
}

function validationError(input: Record<string, unknown>): ApiError {
  const issues = issuesFor(input);
  const message = (issues as { message: string }[]).map((i) => i.message).join(', ');
  return new ApiError(400, message, {}, 'validation', issues);
}

const step: WorkflowStep = {
  id: 'review',
  name: 'Review',
  executor: 'human',
} as WorkflowStep;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleSaveFailure', () => {
  it('points to the diagram when issues are step-scoped', () => {
    const err = new ApiError(400, 'bad', {}, 'validation', [
      { path: ['steps', 0, 'name'], message: 'Too small: expected string to have >=1 characters' },
    ]);

    const result = handleSaveFailure(err, [step]);

    expect(result.message).toBe('Some steps have errors — check the highlighted steps in the diagram.');
    expect(result.stepErrors).toEqual({
      review: { name: 'Too small: expected string to have >=1 characters' },
    });
  });

  it('names the offending field for a missing required value', () => {
    const result = handleSaveFailure(validationError({ name: '', steps: [], transitions: [] }), []);

    expect(result.message).toContain('name');
    expect(result.message).toMatch(/required|empty/i);
    expect(result.stepErrors).toEqual({});
  });

  it('does not leak raw Zod jargon for the issue #1034 repro', () => {
    const result = handleSaveFailure(validationError({ name: '', steps: [], transitions: [] }), []);

    expect(result.message).not.toMatch(/Too small|expected string to have|>=/);
  });

  it('reports every issue instead of collapsing to the first', () => {
    const err = new ApiError(400, 'joined', {}, 'validation', [
      { path: ['name'], code: 'too_small', origin: 'string', minimum: 1, message: 'Too small' },
      { path: ['description'], code: 'invalid_type', expected: 'string', message: 'Invalid input' },
    ]);

    const result = handleSaveFailure(err, []);

    expect(result.message).toContain('name');
    expect(result.message).toContain('description');
  });

  it('lists the allowed values for an invalid option', () => {
    const err = new ApiError(400, 'bad', {}, 'validation', [
      { path: ['kind'], code: 'invalid_value', values: ['creation', 'review'], message: 'Invalid option' },
    ]);

    expect(handleSaveFailure(err, []).message).toBe('kind must be one of: creation, review.');
  });

  it('caps a long issue list and says how many were omitted', () => {
    const issues = Array.from({ length: 7 }, (_, i) => ({
      path: [`field${i}`],
      code: 'invalid_type',
      expected: 'string',
      message: 'Invalid input',
    }));

    const result = handleSaveFailure(new ApiError(400, 'many', {}, 'validation', issues), []);

    expect(result.message).toContain('field0');
    expect(result.message).toContain('and 3 more');
    expect(result.message).not.toContain('field4');
  });

  it('passes a human-readable server message through unchanged', () => {
    const message = 'The name "x" was previously used by a deleted workflow. Please choose a different name.';

    expect(handleSaveFailure(new ApiError(409, message, {}), []).message).toBe(message);
  });

  it('falls back to a generic message when there is nothing to show', () => {
    expect(handleSaveFailure(new Error(''), []).message).toBe(
      'Unable to save the workflow. Please try again.',
    );
    expect(handleSaveFailure({}, []).message).toBe('Unable to save the workflow. Please try again.');
  });

  it('logs the original error so the raw text stays recoverable', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new ApiError(400, 'raw server text', {}, 'validation', []);

    handleSaveFailure(err, []);

    expect(spy).toHaveBeenCalledWith('Workflow save failed', err);
  });
});

describe('validateSteps — issue #1031 (unnamed parameters)', () => {
  it('rejects a blank parameter name before it ever reaches the server', () => {
    const steps: WorkflowStep[] = [
      { ...step, params: [{ name: '', type: 'string', required: false }] },
    ];

    expect(validateSteps(steps)).toMatch(/parameter name.*empty.*"Review"/i);
  });

  it('rejects a whitespace-only parameter name', () => {
    const steps: WorkflowStep[] = [
      { ...step, params: [{ name: '   ', type: 'string', required: false }] },
    ];

    expect(validateSteps(steps)).toMatch(/parameter name.*empty.*"Review"/i);
  });

  it('rejects duplicate parameter names on the same step', () => {
    const steps: WorkflowStep[] = [
      {
        ...step,
        params: [
          { name: 'amount', type: 'string', required: false },
          { name: 'amount', type: 'number', required: false },
        ],
      },
    ];

    expect(validateSteps(steps)).toMatch(/duplicate parameter name.*"amount".*"Review"/i);
  });

  it('passes when every parameter is named and unique', () => {
    const steps: WorkflowStep[] = [
      {
        ...step,
        params: [
          { name: 'amount', type: 'string', required: false },
          { name: 'reason', type: 'string', required: false },
        ],
      },
    ];

    expect(validateSteps(steps)).toBeNull();
  });
});

describe('validateSteps — script config', () => {
  const terminal: WorkflowStep = {
    id: 'no-deliveries',
    name: 'No deliveries',
    type: 'terminal',
    executor: 'script',
  } as WorkflowStep;

  it('accepts a terminal step whose executor is filler', () => {
    expect(validateSteps([step, terminal])).toBeNull();
  });

  it('rejects a script step whose plugin config is missing', () => {
    const steps: WorkflowStep[] = [
      {
        id: 'poll',
        name: 'Poll SFTP',
        type: 'creation',
        executor: 'script',
        plugin: 'script-container',
      } as WorkflowStep,
    ];

    expect(validateSteps(steps)).toMatch(/script config required.*"Poll SFTP".*needs script/i);
  });

  it('rejects a databricks step carrying container script config instead', () => {
    const steps: WorkflowStep[] = [
      {
        id: 'job',
        name: 'Run job',
        type: 'creation',
        executor: 'script',
        plugin: 'databricks-job',
        script: { command: 'python3 run.py', image: 'img:latest' },
      } as WorkflowStep,
    ];

    expect(validateSteps(steps)).toMatch(/script config required.*"Run job".*needs databricks/i);
  });
});
