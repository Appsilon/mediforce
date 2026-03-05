import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditRepository } from '@mediforce/platform-core';
import type { AuditEvent } from '@mediforce/platform-core';

function createTestEvent(
  overrides: Partial<Omit<AuditEvent, 'serverTimestamp'>> = {},
): Omit<AuditEvent, 'serverTimestamp'> {
  return {
    actorId: 'user-001',
    actorType: 'user',
    actorRole: 'reviewer',
    action: 'review.submitted',
    description: 'Submitted supply chain review',
    timestamp: new Date().toISOString(),
    inputSnapshot: { data: 'input' },
    outputSnapshot: { result: 'output' },
    basis: 'FDA 21 CFR Part 11',
    entityType: 'case',
    entityId: 'case-123',
    ...overrides,
  };
}

describe('InMemoryAuditRepository', () => {
  let repo: InMemoryAuditRepository;

  beforeEach(() => {
    repo = new InMemoryAuditRepository();
  });

  describe('append', () => {
    it('stores event and returns with serverTimestamp populated', async () => {
      const event = createTestEvent();
      const result = await repo.append(event);

      expect(result.serverTimestamp).toBeDefined();
      expect(typeof result.serverTimestamp).toBe('string');
      expect(repo.getAll()).toHaveLength(1);
    });

    it('preserves all ALCOA+ fields', async () => {
      const event = createTestEvent({
        actorId: 'agent-042',
        actorType: 'agent',
        actorRole: 'supply-reviewer',
        action: 'compliance.check.completed',
        description: 'Automated compliance check',
        inputSnapshot: { supplierId: 'SUP-001', metrics: [1.2, 3.4] },
        outputSnapshot: { verdict: 'compliant', confidence: 0.95 },
        basis: 'Protocol v2.1 Section 4.3',
        entityType: 'participant',
        entityId: 'participant-789',
        processInstanceId: 'proc-456',
        stepId: 'step-supply-review',
        processDefinitionVersion: '1.0.0',
      });

      const result = await repo.append(event);

      // Attributable
      expect(result.actorId).toBe('agent-042');
      expect(result.actorType).toBe('agent');
      expect(result.actorRole).toBe('supply-reviewer');

      // Legible
      expect(result.action).toBe('compliance.check.completed');
      expect(result.description).toBe('Automated compliance check');

      // Contemporaneous
      expect(result.timestamp).toBe(event.timestamp);
      expect(result.serverTimestamp).toBeDefined();

      // Original
      expect(result.inputSnapshot).toEqual({
        supplierId: 'SUP-001',
        metrics: [1.2, 3.4],
      });
      expect(result.outputSnapshot).toEqual({
        verdict: 'compliant',
        confidence: 0.95,
      });

      // Accurate
      expect(result.basis).toBe('Protocol v2.1 Section 4.3');

      // Complete
      expect(result.entityType).toBe('participant');
      expect(result.entityId).toBe('participant-789');
      expect(result.processInstanceId).toBe('proc-456');
      expect(result.stepId).toBe('step-supply-review');

      // Consistent
      expect(result.processDefinitionVersion).toBe('1.0.0');
    });
  });

  describe('getByEntity', () => {
    it('returns events matching entityType and entityId', async () => {
      await repo.append(
        createTestEvent({ entityType: 'case', entityId: 'case-1' }),
      );
      await repo.append(
        createTestEvent({ entityType: 'case', entityId: 'case-2' }),
      );
      await repo.append(
        createTestEvent({ entityType: 'case', entityId: 'case-1' }),
      );

      const results = await repo.getByEntity('case', 'case-1');
      expect(results).toHaveLength(2);
      results.forEach((e) => {
        expect(e.entityType).toBe('case');
        expect(e.entityId).toBe('case-1');
      });
    });

    it('returns empty array for no matches', async () => {
      await repo.append(
        createTestEvent({ entityType: 'case', entityId: 'case-1' }),
      );

      const results = await repo.getByEntity('case', 'nonexistent');
      expect(results).toHaveLength(0);
    });

    it('returns events in timestamp descending order', async () => {
      await repo.append(
        createTestEvent({
          entityType: 'case',
          entityId: 'case-1',
          timestamp: '2026-01-01T10:00:00.000Z',
        }),
      );
      await repo.append(
        createTestEvent({
          entityType: 'case',
          entityId: 'case-1',
          timestamp: '2026-01-01T12:00:00.000Z',
        }),
      );
      await repo.append(
        createTestEvent({
          entityType: 'case',
          entityId: 'case-1',
          timestamp: '2026-01-01T08:00:00.000Z',
        }),
      );

      const results = await repo.getByEntity('case', 'case-1');
      expect(results[0].timestamp).toBe('2026-01-01T12:00:00.000Z');
      expect(results[1].timestamp).toBe('2026-01-01T10:00:00.000Z');
      expect(results[2].timestamp).toBe('2026-01-01T08:00:00.000Z');
    });
  });

  describe('getByProcess', () => {
    it('returns events with matching processInstanceId', async () => {
      await repo.append(
        createTestEvent({ processInstanceId: 'proc-1' }),
      );
      await repo.append(
        createTestEvent({ processInstanceId: 'proc-2' }),
      );
      await repo.append(
        createTestEvent({ processInstanceId: 'proc-1' }),
      );

      const results = await repo.getByProcess('proc-1');
      expect(results).toHaveLength(2);
      results.forEach((e) => {
        expect(e.processInstanceId).toBe('proc-1');
      });
    });

    it('returns empty array when no events match', async () => {
      await repo.append(
        createTestEvent({ processInstanceId: 'proc-1' }),
      );

      const results = await repo.getByProcess('nonexistent');
      expect(results).toHaveLength(0);
    });
  });

  describe('getByActor', () => {
    it('returns events matching actorId', async () => {
      await repo.append(createTestEvent({ actorId: 'user-A' }));
      await repo.append(createTestEvent({ actorId: 'user-B' }));
      await repo.append(createTestEvent({ actorId: 'user-A' }));

      const results = await repo.getByActor('user-A');
      expect(results).toHaveLength(2);
      results.forEach((e) => {
        expect(e.actorId).toBe('user-A');
      });
    });

    it('respects limit option', async () => {
      await repo.append(
        createTestEvent({
          actorId: 'user-A',
          timestamp: '2026-01-01T08:00:00.000Z',
        }),
      );
      await repo.append(
        createTestEvent({
          actorId: 'user-A',
          timestamp: '2026-01-01T10:00:00.000Z',
        }),
      );
      await repo.append(
        createTestEvent({
          actorId: 'user-A',
          timestamp: '2026-01-01T12:00:00.000Z',
        }),
      );

      const results = await repo.getByActor('user-A', { limit: 2 });
      expect(results).toHaveLength(2);
      // Should be the 2 most recent (desc order)
      expect(results[0].timestamp).toBe('2026-01-01T12:00:00.000Z');
      expect(results[1].timestamp).toBe('2026-01-01T10:00:00.000Z');
    });
  });

  describe('helper methods', () => {
    it('getAll returns all stored events', async () => {
      await repo.append(createTestEvent());
      await repo.append(createTestEvent());
      expect(repo.getAll()).toHaveLength(2);
    });

    it('clear removes all stored events', async () => {
      await repo.append(createTestEvent());
      await repo.append(createTestEvent());
      repo.clear();
      expect(repo.getAll()).toHaveLength(0);
    });
  });
});
