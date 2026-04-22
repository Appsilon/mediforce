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
