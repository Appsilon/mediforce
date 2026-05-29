import { describe, it, expect } from 'vitest';
import { WorkflowDefinitionSchema } from '../workflow-definition';

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

  it('accepts a human review step with approve + revise verdicts', () => {
    expect(() => WorkflowDefinitionSchema.parse(wdWithReview)).not.toThrow();
  });

  it('accepts a human review step with N custom verdict keys (no autonomyLevel)', () => {
    // Allowlist applies to L3 only — human review steps can carry any verdict
    // key, with label/intent/requiresComment overrides.
    const wd = {
      ...wdWithReview,
      steps: wdWithReview.steps.map((step) =>
        step.id === 'review'
          ? {
              ...step,
              verdicts: {
                accept: { target: 'done', label: 'Accept', intent: 'success' as const },
                reject: {
                  target: 'scan',
                  label: 'Reject',
                  intent: 'danger' as const,
                  requiresComment: true,
                },
                ask_changes: {
                  target: 'scan',
                  label: 'Ask for changes',
                  intent: 'warning' as const,
                  requiresComment: true,
                },
              },
            }
          : step,
      ),
    };
    expect(() => WorkflowDefinitionSchema.parse(wd)).not.toThrow();
  });

  it('accepts an L3 agent step with approve + revise verdicts', () => {
    const wd = {
      ...wdWithReview,
      steps: wdWithReview.steps.map((step) =>
        step.id === 'review'
          ? {
              ...step,
              executor: 'agent' as const,
              autonomyLevel: 'L3' as const,
              verdicts: {
                approve: { target: 'done' },
                revise: { target: 'review' },
              },
            }
          : step,
      ),
    };
    expect(() => WorkflowDefinitionSchema.parse(wd)).not.toThrow();
  });

  it('rejects an L3 agent step using a verdict key outside the L3 allowlist', () => {
    const wd = {
      ...wdWithReview,
      steps: wdWithReview.steps.map((step) =>
        step.id === 'review'
          ? {
              ...step,
              executor: 'agent' as const,
              autonomyLevel: 'L3' as const,
              verdicts: {
                accept: { target: 'done' },
                retry: { target: 'review' },
              },
            }
          : step,
      ),
    };
    const result = WorkflowDefinitionSchema.safeParse(wd);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages.some((m) => /verdict key 'accept'.*L3 step.*not allowed/.test(m))).toBe(true);
      expect(messages.some((m) => /verdict key 'retry'.*L3 step.*not allowed/.test(m))).toBe(true);
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

  it('does not enforce the L3 allowlist on non-L3 steps', () => {
    // A `decision` step or any non-L3 step can keep custom verdict keys —
    // the L3 revision loop is the only constraint.
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

describe('WorkflowDefinitionSchema — assignedTo', () => {
  it('accepts assignedTo (with interpolation) on a human step', () => {
    const wd = {
      ...baseWd,
      steps: [
        { id: 'scan', name: 'Scan', type: 'creation' as const, executor: 'script' as const },
        {
          id: 'review',
          name: 'Review',
          type: 'creation' as const,
          executor: 'human' as const,
          assignedTo: '${triggerPayload.userId}',
        },
        { id: 'done', name: 'Done', type: 'terminal' as const, executor: 'human' as const },
      ],
      transitions: [
        { from: 'scan', to: 'review' },
        { from: 'review', to: 'done' },
      ],
    };
    expect(() => WorkflowDefinitionSchema.parse(wd)).not.toThrow();
  });

  it('rejects assignedTo on a non-human step', () => {
    const wd = {
      ...baseWd,
      steps: [
        {
          id: 'scan',
          name: 'Scan',
          type: 'creation' as const,
          executor: 'script' as const,
          assignedTo: '${triggerPayload.userId}',
        },
        { id: 'done', name: 'Done', type: 'terminal' as const, executor: 'human' as const },
      ],
    };
    const result = WorkflowDefinitionSchema.safeParse(wd);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          /assignedTo.*executor is 'script'/.test(issue.message),
        ),
      ).toBe(true);
    }
  });
});
