import { describe, it, expect } from 'vitest';
import { WorkflowDefinitionSchema } from '../workflow-definition.js';

const baseWd = {
  name: 'sftp-monitor',
  version: 1,
  namespace: 'test',
  steps: [
    { id: 'scan', name: 'Scan', type: 'creation' as const, executor: 'script' as const },
    { id: 'done', name: 'Done', type: 'terminal' as const, executor: 'human' as const },
  ],
  transitions: [{ from: 'scan', to: 'done' }],
  triggers: [{ type: 'manual' as const, name: 'Start' }],
};

describe('WorkflowDefinitionSchema — inputForNextRun', () => {
  it('accepts a definition without inputForNextRun', () => {
    expect(() => WorkflowDefinitionSchema.parse(baseWd)).not.toThrow();
  });

  it('accepts a definition with valid inputForNextRun', () => {
    const wd = {
      ...baseWd,
      inputForNextRun: [{ stepId: 'scan', output: 'cursor', as: 'cursor' }],
    };
    expect(() => WorkflowDefinitionSchema.parse(wd)).not.toThrow();
  });

  it('rejects when stepId does not match any step', () => {
    const wd = {
      ...baseWd,
      inputForNextRun: [
        { stepId: 'does-not-exist', output: 'cursor', as: 'cursor' },
      ],
    };
    const result = WorkflowDefinitionSchema.safeParse(wd);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(
        /does not match any step id/,
      );
    }
  });

  it('rejects duplicate `as` names within inputForNextRun', () => {
    const wd = {
      ...baseWd,
      inputForNextRun: [
        { stepId: 'scan', output: 'cursor', as: 'cursor' },
        { stepId: 'scan', output: 'other', as: 'cursor' },
      ],
    };
    const result = WorkflowDefinitionSchema.safeParse(wd);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => /duplicated/.test(i.message)),
      ).toBe(true);
    }
  });

  it('rejects empty string fields in an entry', () => {
    const wd = {
      ...baseWd,
      inputForNextRun: [{ stepId: '', output: '', as: '' }],
    };
    expect(WorkflowDefinitionSchema.safeParse(wd).success).toBe(false);
  });
});

describe('WorkflowDefinitionSchema — verdicts', () => {
  const wdWithReview = {
    ...baseWd,
    steps: [
      { id: 'scan', name: 'Scan', type: 'creation' as const, executor: 'script' as const },
      {
        id: 'review',
        name: 'Review',
        type: 'review' as const,
        executor: 'human' as const,
        verdicts: {
          approve: { target: 'done' },
          revise: { target: 'scan' },
        },
      },
      { id: 'done', name: 'Done', type: 'terminal' as const, executor: 'human' as const },
    ],
    transitions: [
      { from: 'scan', to: 'review' },
    ],
  };

  it('accepts a review step with approve + revise verdicts', () => {
    expect(() => WorkflowDefinitionSchema.parse(wdWithReview)).not.toThrow();
  });

  it('rejects a review step using a verdict key outside the allowlist', () => {
    const wd = {
      ...wdWithReview,
      steps: wdWithReview.steps.map((step) =>
        step.id === 'review'
          ? {
              ...step,
              verdicts: {
                accept: { target: 'done' },
                reject: { target: 'scan' },
              },
            }
          : step,
      ),
    };
    const result = WorkflowDefinitionSchema.safeParse(wd);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages.some((m) => /verdict key 'accept'.*not allowed/.test(m))).toBe(true);
      expect(messages.some((m) => /verdict key 'reject'.*not allowed/.test(m))).toBe(true);
    }
  });

  it('rejects when a verdict target points at a missing step', () => {
    const wd = {
      ...wdWithReview,
      steps: wdWithReview.steps.map((step) =>
        step.id === 'review'
          ? {
              ...step,
              verdicts: {
                approve: { target: 'nope' },
                revise: { target: 'scan' },
              },
            }
          : step,
      ),
    };
    const result = WorkflowDefinitionSchema.safeParse(wd);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          /verdict 'approve'.*targets 'nope'.*does not match/.test(issue.message),
        ),
      ).toBe(true);
    }
  });

  it('does not enforce the allowlist on non-review steps that carry verdicts', () => {
    // A `decision` step type can keep custom verdict keys — only `review`
    // is bound to the built-in form's hardcoded {approve, revise}.
    const wd = {
      ...wdWithReview,
      steps: wdWithReview.steps.map((step) =>
        step.id === 'review'
          ? {
              ...step,
              type: 'decision' as const,
              verdicts: {
                'route-a': { target: 'done' },
                'route-b': { target: 'scan' },
              },
            }
          : step,
      ),
    };
    expect(() => WorkflowDefinitionSchema.parse(wd)).not.toThrow();
  });
});
