import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  buildAuditEvent,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { listNamespaceAuditEvents } from '../list-namespace-audit-events';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('listNamespaceAuditEvents handler', () => {
  let auditRepo: InMemoryAuditRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-b', namespace: 'team-beta' }),
    );
    await auditRepo.append(
      buildAuditEvent({ processInstanceId: 'inst-a', action: 'instance.started' }),
    );
    await auditRepo.append(
      buildAuditEvent({ processInstanceId: 'inst-a', action: 'task.completed' }),
    );
    await auditRepo.append(
      buildAuditEvent({ processInstanceId: 'inst-b', action: 'instance.started' }),
    );
    // Workspace-scoped event with no parent run (a sign-in) — resolved via
    // the explicit `namespace` write-time hint, not a process instance.
    await auditRepo.append(
      buildAuditEvent({
        processInstanceId: undefined,
        namespace: 'team-alpha',
        action: 'user.signed_in',
        entityType: 'user',
        entityId: 'u-1',
      }),
    );
  });

  it('returns every event for the namespace, including parent-less ones (api-key)', async () => {
    const scope = createTestScope({ auditRepo, instanceRepo });
    const result = await listNamespaceAuditEvents({ namespace: 'team-alpha' }, scope);

    expect(result.events.map((e) => e.action).sort()).toEqual([
      'instance.started',
      'task.completed',
      'user.signed_in',
    ]);
  });

  it('returns events for an in-namespace user caller', async () => {
    const scope = createTestScope({
      auditRepo,
      instanceRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    const result = await listNamespaceAuditEvents({ namespace: 'team-alpha' }, scope);

    expect(result.events).toHaveLength(3);
  });

  it('returns empty for an out-of-namespace user caller (anti-enumeration)', async () => {
    const scope = createTestScope({
      auditRepo,
      instanceRepo,
      caller: userCaller('u-2', ['team-beta']),
    });
    const result = await listNamespaceAuditEvents({ namespace: 'team-alpha' }, scope);

    expect(result.events).toEqual([]);
  });
});
