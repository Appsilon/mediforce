import { describe, it, expect } from 'vitest';
import {
  assertNamespaceAccess,
  callerCanAccess,
  filterByCaller,
  type CallerIdentity,
} from '../auth.js';
import { ForbiddenError } from '../errors.js';

const apiKey: CallerIdentity = { kind: 'apiKey', isSystemActor: true };
const userInNsA: CallerIdentity = {
  kind: 'user',
  uid: 'u-1',
  namespaces: new Set(['ns-a']),
  isSystemActor: false,
};

// The full matrix (every kind x every namespace state) is exercised
// through caller fixtures in L2 handler tests; here we only assert
// the helper contracts themselves: happy path, sad path, undefined.

describe('assertNamespaceAccess', () => {
  it('lets api-key callers through (happy)', () => {
    expect(() => assertNamespaceAccess(apiKey, 'ns-a')).not.toThrow();
  });

  it('throws ForbiddenError when the user is not a member (sad)', () => {
    expect(() => assertNamespaceAccess(userInNsA, 'ns-b')).toThrow(ForbiddenError);
  });

  it('throws ForbiddenError when the namespace is undefined for a user (edge)', () => {
    expect(() => assertNamespaceAccess(userInNsA, undefined)).toThrow(ForbiddenError);
  });
});

describe('callerCanAccess', () => {
  it('returns true for a user with the namespace in their set (happy)', () => {
    expect(callerCanAccess(userInNsA, 'ns-a')).toBe(true);
  });

  it('returns false for a user outside the namespace (sad)', () => {
    expect(callerCanAccess(userInNsA, 'ns-b')).toBe(false);
  });

  it('returns false for a user when namespace is undefined (edge)', () => {
    expect(callerCanAccess(userInNsA, undefined)).toBe(false);
  });
});

describe('filterByCaller', () => {
  interface Item {
    readonly id: string;
    readonly namespace?: string;
  }
  const items: readonly Item[] = [
    { id: '1', namespace: 'ns-a' },
    { id: '2', namespace: 'ns-b' },
    { id: '3' }, // no namespace
  ];

  it('returns the whole list (cloned) for api-key callers (happy)', () => {
    const result = filterByCaller(items, apiKey, (i) => i.namespace);
    expect(result.map((i) => i.id)).toEqual(['1', '2', '3']);
    expect(result).not.toBe(items);
  });

  it('keeps only entities in namespaces the user can access (sad path drops the rest)', () => {
    const result = filterByCaller(items, userInNsA, (i) => i.namespace);
    expect(result.map((i) => i.id)).toEqual(['1']);
  });
});
