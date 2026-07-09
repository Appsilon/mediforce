import { describe, expect, it } from 'vitest';
import type { CallerScope } from '../../repositories/index';
import { NotFoundError } from '../../errors';
import { getByIdAdapter, listAdapter } from '../_generic';

const fakeScope = {} as unknown as CallerScope;

describe('listAdapter', () => {
  it('wraps the fetched list under the given envelope key', async () => {
    const handler = listAdapter('items', async () => [{ id: 'a' }, { id: 'b' }]);
    const result = await handler({}, fakeScope);
    expect(result).toEqual({ items: [{ id: 'a' }, { id: 'b' }] });
  });

  it('passes input + scope through to the fetch callback', async () => {
    let seenInput: unknown;
    let seenScope: unknown;
    const handler = listAdapter('agents', async (input: { tag: string }, scope) => {
      seenInput = input;
      seenScope = scope;
      return [];
    });
    await handler({ tag: 'x' }, fakeScope);
    expect(seenInput).toEqual({ tag: 'x' });
    expect(seenScope).toBe(fakeScope);
  });
});

describe('getByIdAdapter', () => {
  it('returns the entity directly when no envelope key is given', async () => {
    const handler = getByIdAdapter(
      async () => ({ id: 'x', name: 'foo' }),
      'Not found',
    );
    const result = await handler({}, fakeScope);
    expect(result).toEqual({ id: 'x', name: 'foo' });
  });

  it('wraps the entity under the envelope key when provided', async () => {
    const handler = getByIdAdapter(
      async () => ({ id: 'x' }),
      'Not found',
      'agent',
    );
    const result = await handler({}, fakeScope);
    expect(result).toEqual({ agent: { id: 'x' } });
  });

  it('throws NotFoundError with a string message when the fetch returns null', async () => {
    const handler = getByIdAdapter<{ id: string }, unknown>(
      async () => null,
      'Task not found',
    );
    await expect(handler({ id: 'missing' }, fakeScope)).rejects.toThrow(NotFoundError);
    await expect(handler({ id: 'missing' }, fakeScope)).rejects.toThrow('Task not found');
  });

  it('throws NotFoundError with a function-built message including input fields', async () => {
    const handler = getByIdAdapter<{ id: string }, unknown>(
      async () => null,
      (input) => `Entity ${input.id} not found`,
    );
    await expect(handler({ id: 'abc' }, fakeScope)).rejects.toThrow('Entity abc not found');
  });

  it('throws NotFoundError even with the envelope-key overload', async () => {
    const handler = getByIdAdapter<{ id: string }, unknown, 'agent'>(
      async () => null,
      (input) => `Agent ${input.id} not found`,
      'agent',
    );
    await expect(handler({ id: 'zzz' }, fakeScope)).rejects.toThrow(NotFoundError);
    await expect(handler({ id: 'zzz' }, fakeScope)).rejects.toThrow('Agent zzz not found');
  });

  it('passes input + scope through to the fetch callback', async () => {
    let seenInput: unknown;
    let seenScope: unknown;
    const handler = getByIdAdapter(
      async (input: { id: string }, scope) => {
        seenInput = input;
        seenScope = scope;
        return { id: input.id };
      },
      'Not found',
    );
    await handler({ id: 'q' }, fakeScope);
    expect(seenInput).toEqual({ id: 'q' });
    expect(seenScope).toBe(fakeScope);
  });
});
