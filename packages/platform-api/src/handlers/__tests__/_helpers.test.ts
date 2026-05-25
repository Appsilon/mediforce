import { describe, it, expect } from 'vitest';
import { loadOr404 } from '../_helpers.js';
import { ApiError } from '../../errors.js';

/**
 * Tests for the shared handler helpers. Right now `loadOr404` is the only
 * exported helper — co-located here per the boundary guard's sibling-test
 * rule (`api-boundaries.test.ts`).
 */

describe('loadOr404', () => {
  it('resolves to the entity when the lookup yields a non-null value', async () => {
    const result = await loadOr404(Promise.resolve({ id: 'x' }), 'should not throw');
    expect(result).toEqual({ id: 'x' });
  });

  it('throws ApiError(`not_found`) with the supplied message when the lookup yields null', async () => {
    const err = await loadOr404(Promise.resolve(null as { id: string } | null), 'Task not found').catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('not_found');
    expect((err as ApiError).message).toBe('Task not found');
  });

  it('uses ApiError so the typed envelope is produced', async () => {
    const err = await loadOr404(Promise.resolve(null), 'missing').catch((e) => e);
    expect((err as ApiError).name).toBe('ApiError');
  });
});
