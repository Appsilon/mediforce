import type { CallerScope } from '../repositories/index.js';
import { ApiError } from '../errors.js';

type ScopeHandler<Input, Output> = (input: Input, scope: CallerScope) => Promise<Output>;

/**
 * Build a handler that calls a scope-bound list method and wraps the result
 * with a single envelope key. Use when the handler would otherwise be
 * `return { [key]: await scope.X.list() }` — no transform, no extra logic.
 */
export function listAdapter<Input, Item, Key extends string>(
  envelopeKey: Key,
  fetch: (input: Input, scope: CallerScope) => Promise<readonly Item[]>,
): ScopeHandler<Input, Record<Key, readonly Item[]>> {
  return async (input, scope) =>
    ({ [envelopeKey]: await fetch(input, scope) }) as Record<Key, readonly Item[]>;
}

/**
 * Build a handler that calls a scope-bound lookup, throws
 * `ApiError('not_found', …)` on null, and returns the entity directly.
 */
export function getByIdAdapter<Input, Item>(
  fetch: (input: Input, scope: CallerScope) => Promise<Item | null>,
  notFoundMessage: string | ((input: Input) => string),
): ScopeHandler<Input, Item>;

/**
 * Overload — same as above but wraps the entity under an envelope key.
 */
export function getByIdAdapter<Input, Item, Key extends string>(
  fetch: (input: Input, scope: CallerScope) => Promise<Item | null>,
  notFoundMessage: string | ((input: Input) => string),
  envelopeKey: Key,
): ScopeHandler<Input, Record<Key, Item>>;

export function getByIdAdapter<Input, Item, Key extends string>(
  fetch: (input: Input, scope: CallerScope) => Promise<Item | null>,
  notFoundMessage: string | ((input: Input) => string),
  envelopeKey?: Key,
): ScopeHandler<Input, Item | Record<Key, Item>> {
  return async (input, scope) => {
    const result = await fetch(input, scope);
    if (result === null) {
      const msg = typeof notFoundMessage === 'function' ? notFoundMessage(input) : notFoundMessage;
      throw new ApiError('not_found', msg);
    }
    return envelopeKey !== undefined
      ? ({ [envelopeKey]: result } as Record<Key, Item>)
      : result;
  };
}
