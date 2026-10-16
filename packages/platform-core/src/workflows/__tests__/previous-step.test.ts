import { describe, it, expect } from 'vitest';
import { resolvePreviousStepId } from '../previous-step';

const transitions = [
  { from: 'draft', to: 'review' },
  { from: 'review', to: 'revise' },
  { from: 'revise', to: 'review' },
  { from: 'review', to: 'publish' },
];

function execution(stepId: string, completedAt: string | null, status: 'completed' | 'running' | 'failed' = 'completed') {
  return { stepId, status, completedAt };
}

describe('resolvePreviousStepId', () => {
  it('is the step that completed last, not the first transition into the current step', () => {
    const executions = [
      execution('draft', '2026-01-01T10:00:00.000Z'),
      execution('review', '2026-01-01T10:05:00.000Z'),
      execution('revise', '2026-01-01T10:10:00.000Z'),
      execution('review', null, 'running'),
    ];

    expect(resolvePreviousStepId(executions, transitions, 'review')).toBe('revise');
  });

  it('ignores executions that have not completed', () => {
    const executions = [
      execution('draft', '2026-01-01T10:00:00.000Z'),
      execution('review', '2026-01-01T10:05:00.000Z', 'failed'),
    ];

    expect(resolvePreviousStepId(executions, transitions, 'review')).toBe('draft');
  });

  it('takes the later-recorded execution when two completed in the same millisecond', () => {
    const executions = [
      execution('draft', '2026-01-01T10:00:00.000Z'),
      execution('revise', '2026-01-01T10:00:00.000Z'),
    ];

    expect(resolvePreviousStepId(executions, transitions, 'review')).toBe('revise');
  });

  it('falls back to the first transition into the step when nothing has completed', () => {
    expect(resolvePreviousStepId([], transitions, 'review')).toBe('draft');
    expect(resolvePreviousStepId([], transitions, 'draft')).toBeNull();
  });
});
