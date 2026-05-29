import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  buildAuditEvent,
  buildProcessInstance,
} from '@mediforce/platform-core/testing';
import { AuthorizedAuditEventRepository } from '../authorized-audit-event-repository.js';
import type { CallerIdentity } from '../../auth.js';

/**
 * Wrapper tests for the audit-event repository. Reads are namespace-gated;
 * writes do not live on this wrapper — handlers emit via `scope.system.audit`
 * (Phase 2 bridge per ADR-0005 §7).
 */

const apiKeyCaller: CallerIdentity = { kind: 'apiKey', isSystemActor: true };

function userCaller(uid: string, namespaces: readonly string[]): CallerIdentity {
  return {
    kind: 'user',
    uid,
    namespaces: new Set(namespaces),
    namespaceRoles: new Map(namespaces.map((handle) => [handle, 'member' as const])),
    isSystemActor: false,
  };
}

describe('AuthorizedAuditEventRepository', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let raw: InMemoryAuditRepository;

  beforeEach(async () => {
    instanceRepo = new InMemoryProcessInstanceRepository();
    raw = new InMemoryAuditRepository(instanceRepo);
    await instanceRepo.create(buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }));
    await instanceRepo.create(buildProcessInstance({ id: 'inst-b', namespace: 'team-beta' }));
    await raw.append(
      buildAuditEvent({
        action: 'task.claimed',
        entityType: 'humanTask',
        entityId: 'task-1',
        processInstanceId: 'inst-a',
      }),
    );
    await raw.append(
      buildAuditEvent({
        action: 'task.claimed',
        entityType: 'humanTask',
        entityId: 'task-foreign',
        processInstanceId: 'inst-b',
      }),
    );
  });

  describe('getByProcess', () => {
    it('returns events for a system-actor caller (no namespace filter)', async () => {
      const wrapper = new AuthorizedAuditEventRepository(apiKeyCaller, raw);

      const events = await wrapper.getByProcess('inst-a');

      expect(events).toHaveLength(1);
      expect(events[0]?.entityId).toBe('task-1');
    });

    it('returns events for an in-scope user caller', async () => {
      const wrapper = new AuthorizedAuditEventRepository(
        userCaller('u-1', ['team-alpha']),
        raw,
      );

      const events = await wrapper.getByProcess('inst-a');

      expect(events).toHaveLength(1);
      expect(events[0]?.entityId).toBe('task-1');
    });

    it('returns empty for an out-of-scope user caller (anti-enum)', async () => {
      const wrapper = new AuthorizedAuditEventRepository(
        userCaller('u-1', ['team-alpha']),
        raw,
      );

      const events = await wrapper.getByProcess('inst-b');

      expect(events).toEqual([]);
    });
  });
});
