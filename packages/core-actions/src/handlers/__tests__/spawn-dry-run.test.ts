import { describe, expect, it, vi } from 'vitest';
import { createSpawnActionHandler } from '../spawn';
import type { ActionContext } from '../../types';

function makeTrigger() {
  return {
    fireWorkflow: vi.fn().mockResolvedValue({ instanceId: 'child-1', status: 'created' }),
  };
}

function makeProcessRepo() {
  return {
    getLatestWorkflowVersion: vi.fn().mockResolvedValue(2),
  };
}

const baseCtx: ActionContext = {
  stepId: 'spawn-step',
  processInstanceId: 'parent-inst',
  namespace: 'test-ns',
  definitionName: 'parent-wf',
  sources: {
    triggerPayload: {},
    steps: {},
    variables: {},
    secrets: {},
  },
};

describe('spawn dryRun propagation', () => {
  it('forwards dryRun: true to fireWorkflow when parent is a dry run', async () => {
    const trigger = makeTrigger();
    const repo = makeProcessRepo();
    const handler = createSpawnActionHandler(trigger as never, repo as never);

    await handler(
      { targets: { definitionName: 'child-wf' }, continueOnSpawnError: true },
      { ...baseCtx, dryRun: true },
    );

    expect(trigger.fireWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
    );
  });

  it('does not forward dryRun when parent is not a dry run', async () => {
    const trigger = makeTrigger();
    const repo = makeProcessRepo();
    const handler = createSpawnActionHandler(trigger as never, repo as never);

    await handler(
      { targets: { definitionName: 'child-wf' }, continueOnSpawnError: true },
      baseCtx,
    );

    const call = trigger.fireWorkflow.mock.calls[0][0];
    expect(call.dryRun).toBeUndefined();
  });

  it('propagates dryRun through forEach fan-out', async () => {
    const trigger = makeTrigger();
    const repo = makeProcessRepo();
    const handler = createSpawnActionHandler(trigger as never, repo as never);

    const ctx: ActionContext = {
      ...baseCtx,
      dryRun: true,
      sources: {
        ...baseCtx.sources,
        steps: { data: { items: [{ id: 1 }, { id: 2 }] } },
        variables: { data: { items: [{ id: 1 }, { id: 2 }] } },
      },
    };

    await handler(
      {
        targets: { definitionName: 'child-wf' },
        forEach: '${steps.data.items}',
        continueOnSpawnError: true,
      },
      ctx,
    );

    expect(trigger.fireWorkflow).toHaveBeenCalledTimes(2);
    for (const call of trigger.fireWorkflow.mock.calls) {
      expect(call[0].dryRun).toBe(true);
    }
  });
});
