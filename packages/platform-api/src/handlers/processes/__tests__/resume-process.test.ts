import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { resumeProcess } from '../resume-process.js';
import { ConflictError, NotFoundError } from '../../../errors.js';

describe('resumeProcess handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository();
  });

  it('moves paused → running and returns ok', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-a', status: 'paused', pauseReason: 'wait_for_escalation' }),
    );

    const result = await resumeProcess(
      { instanceId: 'inst-a' },
      { instanceRepo, auditRepo },
    );

    expect(result).toEqual({ ok: true, instanceId: 'inst-a', status: 'running' });
    const updated = await instanceRepo.getById('inst-a');
    expect(updated?.status).toBe('running');
    expect(updated?.pauseReason).toBeNull();
  });

  it('writes a process.resumed audit event', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'inst-a', status: 'paused' }));

    await resumeProcess({ instanceId: 'inst-a' }, { instanceRepo, auditRepo });

    const events = auditRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('process.resumed');
  });

  it('calls triggerRun when provided', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'inst-a', status: 'paused' }));
    const triggerRun = vi.fn();

    await resumeProcess(
      { instanceId: 'inst-a' },
      { instanceRepo, auditRepo, triggerRun },
    );

    expect(triggerRun).toHaveBeenCalledWith('inst-a', 'api-user');
  });

  it('throws NotFoundError when instance missing', async () => {
    await expect(
      resumeProcess({ instanceId: 'missing' }, { instanceRepo, auditRepo }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ConflictError when instance is not paused', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'inst-a', status: 'running' }));

    await expect(
      resumeProcess({ instanceId: 'inst-a' }, { instanceRepo, auditRepo }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
