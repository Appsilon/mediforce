import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  buildAuditEvent,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { listAuditEvents } from '../list-audit-events.js';

describe('listAuditEvents handler', () => {
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    auditRepo = new InMemoryAuditRepository();
  });

  it('returns every event for the given instance', async () => {
    await auditRepo.append(buildAuditEvent({ processInstanceId: 'inst-a', action: 'step.started' }));
    await auditRepo.append(buildAuditEvent({ processInstanceId: 'inst-a', action: 'step.completed' }));
    await auditRepo.append(buildAuditEvent({ processInstanceId: 'inst-b', action: 'step.started' }));

    const result = await listAuditEvents({ instanceId: 'inst-a' }, { auditRepo });

    expect(result.events).toHaveLength(2);
    expect(result.events.map((e) => e.action).sort()).toEqual([
      'step.completed',
      'step.started',
    ]);
  });

  it('returns an empty array when the instance has no events', async () => {
    const result = await listAuditEvents({ instanceId: 'inst-missing' }, { auditRepo });
    expect(result.events).toEqual([]);
  });
});
