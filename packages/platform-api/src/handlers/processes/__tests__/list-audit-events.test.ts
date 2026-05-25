import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  buildAuditEvent,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { listAuditEvents } from '../list-audit-events.js';
import { ApiError } from '../../../errors.js';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope.js';

describe('listAuditEvents handler', () => {
  let auditRepo: InMemoryAuditRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }),
    );
    await auditRepo.append(
      buildAuditEvent({ processInstanceId: 'inst-a', action: 'step.started' }),
    );
    await auditRepo.append(
      buildAuditEvent({ processInstanceId: 'inst-a', action: 'step.completed' }),
    );
    await auditRepo.append(
      buildAuditEvent({ processInstanceId: 'inst-b', action: 'step.started' }),
    );
  });

  it('returns every event for the instance (api-key)', async () => {
    const scope = createTestScope({ auditRepo, instanceRepo });
    const result = await listAuditEvents(
      { instanceId: 'inst-a' },
      scope,
    );
    expect(result.events).toHaveLength(2);
    expect(result.events.map((e) => e.action).sort()).toEqual([
      'step.completed',
      'step.started',
    ]);
  });

  it('returns events for in-namespace user callers', async () => {
    const scope = createTestScope({
      auditRepo,
      instanceRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    const result = await listAuditEvents(
      { instanceId: 'inst-a' },
      scope,
    );
    expect(result.events).toHaveLength(2);
  });

  it('throws ApiError(not_found) when the instance does not exist', async () => {
    const scope = createTestScope({ auditRepo, instanceRepo });
    await expect(
      listAuditEvents({ instanceId: 'inst-missing' }, scope),
    ).rejects.toThrow(ApiError);
  });

  it('throws ApiError(not_found) (not forbidden) for cross-namespace user callers (anti-enumeration)', async () => {
    const scope = createTestScope({
      auditRepo,
      instanceRepo,
      caller: userCaller('u-2', ['team-beta']),
    });
    await expect(
      listAuditEvents({ instanceId: 'inst-a' }, scope),
    ).rejects.toThrow(ApiError);
  });

  it('throws ApiError(not_found) when the instance has no namespace', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-orphan', namespace: undefined }),
    );
    const scope = createTestScope({
      auditRepo,
      instanceRepo,
      caller: userCaller('u-3', ['team-alpha']),
    });
    await expect(
      listAuditEvents({ instanceId: 'inst-orphan' }, scope),
    ).rejects.toThrow(ApiError);
  });
});
