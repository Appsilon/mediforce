import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getProcess } from '../get-process.js';
import { NotFoundError, ForbiddenError } from '../../../errors.js';
import type { CallerIdentity } from '../../../auth.js';

const apiKey: CallerIdentity = { kind: 'apiKey' };

describe('getProcess handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }),
    );
  });

  it('returns the instance for api-key callers', async () => {
    const result = await getProcess({ instanceId: 'inst-a' }, { instanceRepo }, apiKey);
    expect(result.id).toBe('inst-a');
  });

  it('returns the instance for user callers in the namespace', async () => {
    const user: CallerIdentity = {
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['team-alpha']),
    };

    const result = await getProcess({ instanceId: 'inst-a' }, { instanceRepo }, user);

    expect(result.id).toBe('inst-a');
  });

  it('throws NotFoundError when the instance does not exist', async () => {
    await expect(
      getProcess({ instanceId: 'missing' }, { instanceRepo }, apiKey),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError for cross-namespace user callers', async () => {
    const otherUser: CallerIdentity = {
      kind: 'user',
      uid: 'u-2',
      namespaces: new Set(['team-beta']),
    };

    await expect(
      getProcess({ instanceId: 'inst-a' }, { instanceRepo }, otherUser),
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws ForbiddenError when the instance has no namespace', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-orphan', namespace: undefined }),
    );
    const user: CallerIdentity = {
      kind: 'user',
      uid: 'u-3',
      namespaces: new Set(['team-alpha']),
    };

    await expect(
      getProcess({ instanceId: 'inst-orphan' }, { instanceRepo }, user),
    ).rejects.toThrow(ForbiddenError);
  });

  it('404 still beats 403 for a missing id (no namespace leak)', async () => {
    const user: CallerIdentity = {
      kind: 'user',
      uid: 'u-x',
      namespaces: new Set(),
    };

    await expect(
      getProcess({ instanceId: 'definitely-missing' }, { instanceRepo }, user),
    ).rejects.toThrow(NotFoundError);
  });
});
