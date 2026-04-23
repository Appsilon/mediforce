import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { cancelProcess } from '../cancel-process.js';
import { ConflictError, NotFoundError } from '../../../errors.js';

describe('cancelProcess handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
  });

  it('transitions running → failed with cancellation reason', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'inst-a', status: 'running' }));

    const result = await cancelProcess({ instanceId: 'inst-a' }, { instanceRepo });

    expect(result).toEqual({ instanceId: 'inst-a', status: 'failed' });

    const updated = await instanceRepo.getById('inst-a');
    expect(updated?.status).toBe('failed');
    expect(updated?.error).toBe('Cancelled by user');
  });

  it('transitions paused → failed', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'inst-a', status: 'paused' }));

    const result = await cancelProcess({ instanceId: 'inst-a' }, { instanceRepo });

    expect(result.status).toBe('failed');
  });

  it('throws NotFoundError when instance does not exist', async () => {
    await expect(
      cancelProcess({ instanceId: 'missing' }, { instanceRepo }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ConflictError when instance is already completed', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'inst-a', status: 'completed' }));

    await expect(
      cancelProcess({ instanceId: 'inst-a' }, { instanceRepo }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws ConflictError when instance is already failed', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'inst-a', status: 'failed' }));

    await expect(
      cancelProcess({ instanceId: 'inst-a' }, { instanceRepo }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
