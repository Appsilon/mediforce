import { describe, it, expect } from 'vitest';
import type { WorkflowStep } from '@mediforce/platform-core';
import { childWorkflowTargetOf, latestStepStatus } from '../child-workflow';

const actionStep = (action: WorkflowStep['action']): WorkflowStep =>
  ({ id: 'phase', name: 'Phase', type: 'creation', executor: 'action', action }) as WorkflowStep;

describe('childWorkflowTargetOf', () => {
  it('[UNIT] a run-workflow step starts the workflow it names', () => {
    const step = actionStep({ kind: 'run-workflow', config: { definitionName: 'child', timeout: 'PT1H' } });
    expect(childWorkflowTargetOf(step)).toEqual({ definitionName: 'child', definitionVersion: undefined, forEach: false });
  });

  it('[UNIT] a forEach spawn is one template started per item', () => {
    const step = actionStep({
      kind: 'spawn',
      config: { targets: { definitionName: 'child', definitionVersion: 3 }, forEach: '${items}', continueOnSpawnError: true },
    });
    expect(childWorkflowTargetOf(step)).toEqual({ definitionName: 'child', definitionVersion: 3, forEach: true });
  });

  it('[UNIT] a spawn of several workflows, or a step starting none, has no single child', () => {
    const several = actionStep({
      kind: 'spawn',
      config: { targets: [{ definitionName: 'a' }, { definitionName: 'b' }], continueOnSpawnError: true },
    });
    expect(childWorkflowTargetOf(several)).toBeNull();
    expect(childWorkflowTargetOf(actionStep({ kind: 'collect', config: {} }))).toBeNull();
    expect(childWorkflowTargetOf({ id: 'h', name: 'H', type: 'creation', executor: 'human' } as WorkflowStep)).toBeNull();
  });
});

describe('latestStepStatus', () => {
  it('[UNIT] a step a loop re-ran shows its latest execution', () => {
    const statuses = latestStepStatus([
      { stepId: 'draft', status: 'running', startedAt: '2026-01-01T00:02:00.000Z' },
      { stepId: 'draft', status: 'completed', startedAt: '2026-01-01T00:00:00.000Z' },
      { stepId: 'review', status: 'failed', startedAt: '2026-01-01T00:01:00.000Z' },
    ]);
    expect([...statuses]).toEqual([['draft', 'running'], ['review', 'failed']]);
  });
});
