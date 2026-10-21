import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunWorkflowActionHandler } from '../run-workflow';
import type { ActionContext } from '../../types';

const ctx: ActionContext = {
  stepId: 'intake',
  processInstanceId: 'parent',
  namespace: 'test-ns',
  definitionName: 'orchestrator',
  sources: {
    triggerPayload: {},
    triggerContext: { phaseDeadlineDays: 14 },
    steps: {},
    variables: {},
    secrets: {},
  },
};

function makeSpawn(spawned: Array<{ instanceId: string }> = [{ instanceId: 'child-1' }]) {
  return vi.fn().mockResolvedValue({
    spawned: spawned.map((entry) => ({ ...entry, definitionName: 'intake', definitionVersion: 1, status: 'created' })),
    errors: [],
    spawnedCount: spawned.length,
    errorCount: 0,
  });
}

describe('run-workflow action', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('spawns exactly one child and parks on it until the timeout', async () => {
    const spawn = makeSpawn();
    const handler = createRunWorkflowActionHandler(spawn);

    const output = await handler(
      { definitionName: 'intake', payload: { case: 'C-1' }, timeout: 'P14D', step: 'return_result' },
      ctx,
    );

    expect(spawn).toHaveBeenCalledWith(
      { targets: { definitionName: 'intake', payload: { case: 'C-1' } }, continueOnSpawnError: false },
      ctx,
    );
    expect(output).toEqual({
      __wait: {
        stepId: 'intake',
        resumeAt: '2026-10-15T00:00:00.000Z',
        pausedAt: '2026-10-01T00:00:00.000Z',
        mode: 'deadline',
        child: { instanceId: 'child-1', step: 'return_result' },
      },
    });
  });

  it('interpolates the timeout', async () => {
    const handler = createRunWorkflowActionHandler(makeSpawn());

    const output = await handler(
      { definitionName: 'intake', timeout: 'P${triggerContext.phaseDeadlineDays}D' },
      ctx,
    );

    expect(output).toMatchObject({ __wait: { resumeAt: '2026-10-15T00:00:00.000Z', child: { instanceId: 'child-1' } } });
  });

  it('fails before spawning when the timeout is not a duration', async () => {
    const spawn = makeSpawn();
    const handler = createRunWorkflowActionHandler(spawn);

    await expect(handler({ definitionName: 'intake', timeout: '14 days' }, ctx)).rejects.toThrow(
      "timeout must be an ISO 8601 duration greater than zero (e.g. P14D, PT2H), got '14 days'",
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('fails when no child was started', async () => {
    const handler = createRunWorkflowActionHandler(makeSpawn([]));

    await expect(handler({ definitionName: 'intake', timeout: 'P1D' }, ctx)).rejects.toThrow(
      "workflow 'intake' was not started",
    );
  });
});
