import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryHumanTaskRepository,
  InMemoryProcessInstanceRepository,
  buildHumanTask,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getTask } from '../get-task.js';
import { NotFoundError } from '../../../errors.js';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope.js';

describe('getTask handler', () => {
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);

    await instanceRepo.create(buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }));
    await humanTaskRepo.create(
      buildHumanTask({ id: 't-a', processInstanceId: 'inst-a' }),
    );
  });

  it('returns the task for api-key callers', async () => {
    const scope = createTestScope({ humanTaskRepo, instanceRepo });
    const task = await getTask({ taskId: 't-a' }, scope);
    expect(task.id).toBe('t-a');
  });

  it('returns the task for user callers who are members of the namespace', async () => {
    const scope = createTestScope({
      humanTaskRepo,
      instanceRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const task = await getTask({ taskId: 't-a' }, scope);

    expect(task.id).toBe('t-a');
  });

  it('throws NotFoundError when the task does not exist', async () => {
    const scope = createTestScope({ humanTaskRepo, instanceRepo });
    await expect(
      getTask({ taskId: 'missing' }, scope),
    ).rejects.toThrow(NotFoundError);
  });

  it('returns NotFoundError (anti-enumeration) when a user caller is outside the task’s namespace', async () => {
    const scope = createTestScope({
      humanTaskRepo,
      instanceRepo,
      caller: userCaller('u-2', ['team-beta']),
    });

    await expect(
      getTask({ taskId: 't-a' }, scope),
    ).rejects.toThrow(NotFoundError);
  });

  it('returns NotFoundError when the task’s instance has no namespace', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'inst-orphan', namespace: undefined }));
    await humanTaskRepo.create(buildHumanTask({ id: 't-orphan', processInstanceId: 'inst-orphan' }));
    const scope = createTestScope({
      humanTaskRepo,
      instanceRepo,
      caller: userCaller('u-3', ['team-alpha']),
    });

    await expect(
      getTask({ taskId: 't-orphan' }, scope),
    ).rejects.toThrow(NotFoundError);
  });

  it('checks namespace AFTER the task is fetched (existence-then-policy ordering, both surface as 404)', async () => {
    const scope = createTestScope({
      humanTaskRepo,
      instanceRepo,
      caller: userCaller('u-x', []),
    });


    await expect(
      getTask({ taskId: 'definitely-missing' }, scope),
    ).rejects.toThrow(NotFoundError);
  });
});
