import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryHumanTaskRepository,
  buildHumanTask,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getTask } from '../get-task.js';
import { NotFoundError } from '../../../errors.js';

/**
 * Handler behaviour tests against an in-memory repo — no mocks, no HTTP.
 * Contract parsing is covered in `contract.test.ts`.
 */

describe('getTask handler', () => {
  let humanTaskRepo: InMemoryHumanTaskRepository;

  beforeEach(() => {
    resetFactorySequence();
    humanTaskRepo = new InMemoryHumanTaskRepository();
  });

  it('returns the task when it exists', async () => {
    const stored = buildHumanTask({ id: 'task-1', processInstanceId: 'inst-a' });
    await humanTaskRepo.create(stored);

    const result = await getTask({ taskId: 'task-1' }, { humanTaskRepo });

    expect(result.id).toBe('task-1');
    expect(result.processInstanceId).toBe('inst-a');
  });

  it('returns the full task payload including completionData', async () => {
    await humanTaskRepo.create(
      buildHumanTask({
        id: 'task-review',
        status: 'claimed',
        completionData: { reviewType: 'agent_output_review', confidence: 0.8 },
      }),
    );

    const result = await getTask({ taskId: 'task-review' }, { humanTaskRepo });

    expect(result.completionData).toEqual({
      reviewType: 'agent_output_review',
      confidence: 0.8,
    });
  });

  it('throws NotFoundError when no task has the given id', async () => {
    await expect(
      getTask({ taskId: 'missing' }, { humanTaskRepo }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('NotFoundError carries statusCode 404 and names the task id', async () => {
    const err = await getTask({ taskId: 'missing-42' }, { humanTaskRepo }).catch((e) => e);

    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).statusCode).toBe(404);
    expect((err as NotFoundError).message).toContain('missing-42');
  });
});
