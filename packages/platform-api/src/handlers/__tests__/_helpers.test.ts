import { describe, it, expect } from 'vitest';
import { loadOr404, resolveTargetUid } from '../_helpers';
import { HandlerError, NotFoundError, ValidationError } from '../../errors';
import { createTestScope, userCaller } from '../../repositories/__tests__/create-test-scope';

/**
 * Tests for the shared handler helpers — co-located here per the boundary
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

describe('resolveTargetUid', () => {
  it('resolves a session caller to itself', () => {
    const scope = createTestScope({ caller: userCaller('u-1', ['team-alpha']) });
    expect(resolveTargetUid({}, scope, 'assistant instructions')).toBe('u-1');
  });

  it('accepts a session caller naming its own uid', () => {
    const scope = createTestScope({ caller: userCaller('u-1', ['team-alpha']) });
    expect(resolveTargetUid({ uid: 'u-1' }, scope, 'assistant instructions')).toBe('u-1');
  });

  it('refuses a session caller naming anyone else, and names what was asked for', () => {
    const scope = createTestScope({ caller: userCaller('u-1', ['team-alpha']) });
    expect(() => resolveTargetUid({ uid: 'u-2' }, scope, 'assistant instructions'))
      .toThrow(/another user’s assistant instructions/);
  });

  it('makes a system actor say who it is acting for', () => {
    const scope = createTestScope();
    expect(() => resolveTargetUid({}, scope, 'assistant instructions')).toThrow(ValidationError);
    expect(resolveTargetUid({ uid: 'u-7' }, scope, 'assistant instructions')).toBe('u-7');
  });
});
