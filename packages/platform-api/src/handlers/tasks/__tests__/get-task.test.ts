import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryHumanTaskRepository,
  InMemoryProcessInstanceRepository,
  buildHumanTask,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getTask } from '../get-task.js';
import { NotFoundError, ForbiddenError } from '../../../errors.js';
import type { CallerIdentity } from '../../../auth.js';

const apiKey: CallerIdentity = { kind: 'apiKey' };

describe('getTask handler', () => {
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(async () => {
    resetFactorySequence();
    humanTaskRepo = new InMemoryHumanTaskRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();

    await instanceRepo.create(buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }));
    await humanTaskRepo.create(
      buildHumanTask({ id: 't-a', processInstanceId: 'inst-a' }),
    );
  });

  it('returns the task for api-key callers', async () => {
    const task = await getTask({ taskId: 't-a' }, { humanTaskRepo, instanceRepo }, apiKey);
    expect(task.id).toBe('t-a');
  });

  it('returns the task for user callers who are members of the namespace', async () => {
    const user: CallerIdentity = {
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['team-alpha']),
    };

    const task = await getTask({ taskId: 't-a' }, { humanTaskRepo, instanceRepo }, user);

    expect(task.id).toBe('t-a');
  });

  it('throws NotFoundError when the task does not exist', async () => {
    await expect(
      getTask({ taskId: 'missing' }, { humanTaskRepo, instanceRepo }, apiKey),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError when a user caller is outside the task’s namespace', async () => {
    const otherUser: CallerIdentity = {
      kind: 'user',
      uid: 'u-2',
      namespaces: new Set(['team-beta']),
    };

    await expect(
      getTask({ taskId: 't-a' }, { humanTaskRepo, instanceRepo }, otherUser),
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws ForbiddenError when the task’s instance has no namespace', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'inst-orphan', namespace: undefined }));
    await humanTaskRepo.create(buildHumanTask({ id: 't-orphan', processInstanceId: 'inst-orphan' }));
    const user: CallerIdentity = {
      kind: 'user',
      uid: 'u-3',
      namespaces: new Set(['team-alpha']),
    };

    await expect(
      getTask({ taskId: 't-orphan' }, { humanTaskRepo, instanceRepo }, user),
    ).rejects.toThrow(ForbiddenError);
  });

  it('checks namespace AFTER the task is fetched (404 still beats 403 for missing ids)', async () => {
    const user: CallerIdentity = {
      kind: 'user',
      uid: 'u-x',
      namespaces: new Set(), // empty membership — would 403 anything real
    };

    // A non-existent task still surfaces as 404, never leaks "exists but denied".
    await expect(
      getTask({ taskId: 'definitely-missing' }, { humanTaskRepo, instanceRepo }, user),
    ).rejects.toThrow(NotFoundError);
  });
});
