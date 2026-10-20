import { describe, expect, it } from 'vitest';
import {
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
} from '@mediforce/platform-core/testing';
import { createCollectActionHandler } from '../collect';
import type { ActionContext } from '../../types';

const ctx: ActionContext = {
  stepId: 'collect',
  processInstanceId: 'parent',
  sources: { triggerPayload: {}, steps: {}, variables: {}, secrets: {} },
};

describe('collect action', () => {
  async function seededHandler() {
    const repo = new InMemoryProcessInstanceRepository();
    await repo.create(buildProcessInstance({ id: 'parent', status: 'paused' }));
    await repo.create(
      buildProcessInstance({
        id: 'child-done',
        definitionName: 'perspective',
        status: 'completed',
        parentInstanceId: 'parent',
        variables: { answer: { text: 'ship it' }, other: 1 },
      }),
    );
    await repo.create(
      buildProcessInstance({
        id: 'child-failed',
        definitionName: 'perspective',
        status: 'failed',
        error: 'boom',
        parentInstanceId: 'parent',
        variables: {},
      }),
    );
    await repo.create(
      buildProcessInstance({
        id: 'child-deleted',
        status: 'completed',
        parentInstanceId: 'parent',
        deleted: true,
      }),
    );
    await repo.create(
      buildProcessInstance({ id: 'stranger-child', status: 'completed', parentInstanceId: 'someone-else' }),
    );
    return createCollectActionHandler(repo);
  }

  it('returns each spawned child with its status, error and one step output', async () => {
    const handler = await seededHandler();

    const output = await handler({ step: 'answer' }, ctx);

    expect(output).toMatchObject({ count: 2, completedCount: 1, failedCount: 1 });
    expect(output.children).toEqual(
      expect.arrayContaining([
        { instanceId: 'child-done', definitionName: 'perspective', status: 'completed', error: null, output: { text: 'ship it' } },
        { instanceId: 'child-failed', definitionName: 'perspective', status: 'failed', error: 'boom', output: null },
      ]),
    );
  });

  it('returns the whole variables map when no step is named', async () => {
    const handler = await seededHandler();

    const output = await handler({}, ctx);

    const done = (output.children as Array<{ instanceId: string; output: unknown }>).find(
      (child) => child.instanceId === 'child-done',
    );
    expect(done?.output).toEqual({ answer: { text: 'ship it' }, other: 1 });
  });

  it('returns an empty result when nothing was spawned', async () => {
    const handler = createCollectActionHandler(new InMemoryProcessInstanceRepository());

    const output = await handler({}, ctx);

    expect(output).toEqual({ children: [], count: 0, completedCount: 0, failedCount: 0 });
  });
});
