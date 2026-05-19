import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  buildAuditEvent,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { listAuditEvents } from '../list-audit-events.js';
import { NotFoundError } from '../../../errors.js';
import type { CallerIdentity } from '../../../auth.js';

const apiKey: CallerIdentity = { kind: 'apiKey' };

describe('listAuditEvents handler', () => {
  let auditRepo: InMemoryAuditRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(async () => {
    resetFactorySequence();
    auditRepo = new InMemoryAuditRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
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
    const result = await listAuditEvents(
      { instanceId: 'inst-a' },
      { auditRepo, instanceRepo },
      apiKey,
    );
    expect(result.events).toHaveLength(2);
    expect(result.events.map((e) => e.action).sort()).toEqual([
      'step.completed',
      'step.started',
    ]);
  });

  it('returns events for in-namespace user callers', async () => {
    const user: CallerIdentity = {
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['team-alpha']),
    };
    const result = await listAuditEvents(
      { instanceId: 'inst-a' },
      { auditRepo, instanceRepo },
      user,
    );
    expect(result.events).toHaveLength(2);
  });

  it('throws NotFoundError when the instance does not exist', async () => {
    await expect(
      listAuditEvents({ instanceId: 'inst-missing' }, { auditRepo, instanceRepo }, apiKey),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError (not ForbiddenError) for cross-namespace user callers (anti-enumeration)', async () => {
    const otherUser: CallerIdentity = {
      kind: 'user',
      uid: 'u-2',
      namespaces: new Set(['team-beta']),
    };
    await expect(
      listAuditEvents({ instanceId: 'inst-a' }, { auditRepo, instanceRepo }, otherUser),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when the instance has no namespace', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-orphan', namespace: undefined }),
    );
    const user: CallerIdentity = {
      kind: 'user',
      uid: 'u-3',
      namespaces: new Set(['team-alpha']),
    };
    await expect(
      listAuditEvents({ instanceId: 'inst-orphan' }, { auditRepo, instanceRepo }, user),
    ).rejects.toThrow(NotFoundError);
  });
});
