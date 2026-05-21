import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getProcess } from '../get-process.js';
import { NotFoundError } from '../../../errors.js';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope.js';

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
    const scope = createTestScope({ instanceRepo });
    const result = await getProcess({ instanceId: 'inst-a' }, scope);
    expect(result.id).toBe('inst-a');
  });

  it('returns the instance for user callers in the namespace', async () => {
    const scope = createTestScope({
      instanceRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await getProcess({ instanceId: 'inst-a' }, scope);

    expect(result.id).toBe('inst-a');
  });

  it('throws NotFoundError when the instance does not exist', async () => {
    const scope = createTestScope({ instanceRepo });
    await expect(
      getProcess({ instanceId: 'missing' }, scope),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError (not ForbiddenError) for cross-namespace user callers (anti-enumeration)', async () => {
    const scope = createTestScope({
      instanceRepo,
      caller: userCaller('u-2', ['team-beta']),
    });

    await expect(
      getProcess({ instanceId: 'inst-a' }, scope),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when the instance has no namespace', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-orphan', namespace: undefined }),
    );
    const scope = createTestScope({
      instanceRepo,
      caller: userCaller('u-3', ['team-alpha']),
    });

    await expect(
      getProcess({ instanceId: 'inst-orphan' }, scope),
    ).rejects.toThrow(NotFoundError);
  });

  it('missing id and cross-namespace id are indistinguishable (no enumeration leak)', async () => {
    const scope = createTestScope({
      instanceRepo,
      caller: userCaller('u-x', []),
    });

    await expect(
      getProcess({ instanceId: 'definitely-missing' }, scope),
    ).rejects.toThrow(NotFoundError);
  });
});
