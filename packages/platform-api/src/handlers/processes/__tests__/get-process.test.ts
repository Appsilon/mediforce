import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getProcess } from '../get-process.js';
import { NotFoundError } from '../../../errors.js';

describe('getProcess handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
  });

  it('returns the instance when it exists', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'inst-1' }));

    const result = await getProcess({ instanceId: 'inst-1' }, { instanceRepo });

    expect(result.id).toBe('inst-1');
  });

  it('throws NotFoundError when the instance does not exist', async () => {
    await expect(
      getProcess({ instanceId: 'missing' }, { instanceRepo }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('NotFoundError carries statusCode 404 and names the instance id', async () => {
    const err = await getProcess({ instanceId: 'missing-x' }, { instanceRepo }).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).statusCode).toBe(404);
    expect((err as NotFoundError).message).toContain('missing-x');
  });
});
