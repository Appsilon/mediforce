import { describe, it, expect } from 'vitest';
import { emitAudit, loadOr404 } from '../_helpers.js';
import { HandlerError, NotFoundError } from '../../errors.js';
import type { CallerScope } from '../../repositories/index.js';
import type { AuditEvent } from '@mediforce/platform-core';

/**
 * Tests for the shared handler helpers. Co-located here per the boundary
 * guard's sibling-test rule (`api-boundaries.test.ts`).
 */

describe('loadOr404', () => {
  it('resolves to the entity when the lookup yields a non-null value', async () => {
    const result = await loadOr404(Promise.resolve({ id: 'x' }), 'should not throw');
    expect(result).toEqual({ id: 'x' });
  });

  it('throws NotFoundError (HandlerError subclass) with the supplied message when the lookup yields null', async () => {
    const err = await loadOr404(Promise.resolve(null as { id: string } | null), 'Task not found').catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err).toBeInstanceOf(HandlerError);
    expect((err as NotFoundError).code).toBe('not_found');
    expect((err as NotFoundError).message).toBe('Task not found');
  });
});

interface CapturedAudit {
  readonly events: Array<Omit<AuditEvent, 'serverTimestamp'>>;
}

function buildScope(callerKind: 'user' | 'apiKey'): {
  scope: CallerScope;
  captured: CapturedAudit;
} {
  const captured: CapturedAudit = { events: [] };
  const caller =
    callerKind === 'user'
      ? { kind: 'user' as const, uid: 'user-123', email: 'u@example.com', namespaces: [] }
      : { kind: 'apiKey' as const, keyId: 'k-1', namespaces: [] };
  const scope = {
    caller,
    system: {
      audit: {
        async append(event: Omit<AuditEvent, 'serverTimestamp'>) {
          captured.events.push(event);
          return { ...event, serverTimestamp: '2026-01-01T00:00:00.000Z' };
        },
      },
    },
  } as unknown as CallerScope;
  return { scope, captured };
}

describe('emitAudit', () => {
  const baseArgs = {
    action: 'instance.test',
    description: 'desc',
    basis: 'unit-test',
    entityType: 'processInstance',
    entityId: 'run-1',
    processInstanceId: 'run-1',
  } as const;

  it('defaults actor to actorFromCaller for a user caller', async () => {
    const { scope, captured } = buildScope('user');
    await emitAudit(scope, baseArgs);
    expect(captured.events).toHaveLength(1);
    const event = captured.events[0];
    expect(event.actorId).toBe('user-123');
    expect(event.actorType).toBe('user');
    expect(event.actorRole).toBe('operator');
  });

  it('defaults actor to api-user/system for an apiKey caller', async () => {
    const { scope, captured } = buildScope('apiKey');
    await emitAudit(scope, baseArgs);
    expect(captured.events[0].actorId).toBe('api-user');
    expect(captured.events[0].actorType).toBe('system');
  });

  it('uses an override actor verbatim when supplied', async () => {
    const { scope, captured } = buildScope('apiKey');
    await emitAudit(scope, {
      ...baseArgs,
      actor: { actorId: 'cron-heartbeat', actorType: 'system', actorRole: 'scheduler' },
    });
    const event = captured.events[0];
    expect(event.actorId).toBe('cron-heartbeat');
    expect(event.actorRole).toBe('scheduler');
  });

  it('defaults timestamp to an ISO-8601 string when omitted', async () => {
    const { scope, captured } = buildScope('user');
    await emitAudit(scope, baseArgs);
    expect(captured.events[0].timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it('respects an explicit timestamp override', async () => {
    const { scope, captured } = buildScope('user');
    const ts = '2026-05-27T12:34:56.000Z';
    await emitAudit(scope, { ...baseArgs, timestamp: ts });
    expect(captured.events[0].timestamp).toBe(ts);
  });

  it('defaults input/output snapshots to empty objects', async () => {
    const { scope, captured } = buildScope('user');
    await emitAudit(scope, baseArgs);
    expect(captured.events[0].inputSnapshot).toEqual({});
    expect(captured.events[0].outputSnapshot).toEqual({});
  });

  it('round-trips processDefinitionVersion when provided', async () => {
    const { scope, captured } = buildScope('user');
    await emitAudit(scope, { ...baseArgs, processDefinitionVersion: '7' });
    expect(captured.events[0].processDefinitionVersion).toBe('7');
  });

  it('omits processDefinitionVersion entirely when absent (no undefined key)', async () => {
    const { scope, captured } = buildScope('user');
    await emitAudit(scope, baseArgs);
    expect('processDefinitionVersion' in captured.events[0]).toBe(false);
  });
});
