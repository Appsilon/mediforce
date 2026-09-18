/**
 * Which records an auditor came to read. This is a compliance classification,
 * not a display preference, so it lives beside the schema rather than in a
 * component: the same answer has to hold wherever a trail is shown.
 */
import { describe, it, expect } from 'vitest';
import { auditSignificance } from '../audit-significance';
import type { AuditEvent } from '../audit-event';

function event(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    actorId: 'u-1',
    actorType: 'user',
    actorRole: 'reviewer',
    action: 'task.viewed',
    description: '',
    timestamp: '2026-01-01T00:00:00.000Z',
    inputSnapshot: {},
    outputSnapshot: {},
    basis: '',
    entityType: 'task',
    entityId: 't-1',
    ...overrides,
  };
}

describe('auditSignificance', () => {
  it('counts a human resolving a task as a decision', () => {
    expect(auditSignificance(event({ action: 'task.completed', actorType: 'user' }))).toBe('decision');
  });

  it('does not count the engine closing a task as a decision', () => {
    expect(auditSignificance(event({ action: 'task.completed', actorType: 'system' }))).toBe('routine');
  });

  it('counts cancelling, escalating and overriding autonomy as decisions', () => {
    for (const action of ['instance.cancelled', 'agent.escalated', 'step.autonomy_overridden', 'workflow.access_changed']) {
      expect(auditSignificance(event({ action, actorType: 'user' }))).toBe('decision');
    }
  });

  it('treats run and step lifecycle as transitions', () => {
    for (const action of ['instance.created', 'instance.started', 'instance.completed', 'agent.run']) {
      expect(auditSignificance(event({ action }))).toBe('transition');
    }
  });

  it('treats dispatch chatter and page views as routine', () => {
    for (const action of ['task.viewed', 'task.created', 'process.run.started', 'process.run.step.started', 'process.resumed_after_task', 'step.completed']) {
      expect(auditSignificance(event({ action }))).toBe('routine');
    }
  });

  it('defaults an action it has never seen to a transition, never to routine', () => {
    // An unknown record must not be the one that gets collapsed out of sight.
    expect(auditSignificance(event({ action: 'something.brand_new' }))).toBe('transition');
  });
});
