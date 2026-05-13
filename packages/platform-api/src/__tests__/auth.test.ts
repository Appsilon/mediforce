import { describe, it, expect } from 'vitest';
import {
  assertNamespaceAccess,
  callerCanAccess,
  filterByCaller,
  type CallerIdentity,
} from '../auth.js';
import { ForbiddenError } from '../errors.js';

const apiKey: CallerIdentity = { kind: 'apiKey' };
const userInNsA: CallerIdentity = {
  kind: 'user',
  uid: 'u-1',
  namespaces: new Set(['ns-a']),
};
const userNoNs: CallerIdentity = {
  kind: 'user',
  uid: 'u-2',
  namespaces: new Set(),
};

describe('assertNamespaceAccess', () => {
  it('lets api-key callers through regardless of namespace', () => {
    expect(() => assertNamespaceAccess(apiKey, 'ns-a')).not.toThrow();
    expect(() => assertNamespaceAccess(apiKey, undefined)).not.toThrow();
    expect(() => assertNamespaceAccess(apiKey, '')).not.toThrow();
  });

  it('lets user callers through when the namespace is in their membership set', () => {
    expect(() => assertNamespaceAccess(userInNsA, 'ns-a')).not.toThrow();
  });

  it('throws ForbiddenError when the user is not a member of the namespace', () => {
    expect(() => assertNamespaceAccess(userInNsA, 'ns-b')).toThrow(ForbiddenError);
  });

  it('throws ForbiddenError when the resource has no namespace and the caller is a user', () => {
    expect(() => assertNamespaceAccess(userInNsA, undefined)).toThrow(ForbiddenError);
    expect(() => assertNamespaceAccess(userInNsA, '')).toThrow(ForbiddenError);
  });

  it('throws ForbiddenError when the user has no namespaces at all', () => {
    expect(() => assertNamespaceAccess(userNoNs, 'ns-a')).toThrow(ForbiddenError);
  });
});

describe('callerCanAccess', () => {
  it('returns true for api-key callers regardless of namespace', () => {
    expect(callerCanAccess(apiKey, 'ns-a')).toBe(true);
    expect(callerCanAccess(apiKey, undefined)).toBe(true);
  });

  it('returns true for user callers when the namespace is in their set', () => {
    expect(callerCanAccess(userInNsA, 'ns-a')).toBe(true);
  });

  it('returns false for user callers when the namespace is missing or unknown', () => {
    expect(callerCanAccess(userInNsA, 'ns-b')).toBe(false);
    expect(callerCanAccess(userInNsA, undefined)).toBe(false);
    expect(callerCanAccess(userInNsA, '')).toBe(false);
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

  it('returns the whole list (cloned) for api-key callers', () => {
    const result = filterByCaller(items, apiKey, (i) => i.namespace);
    expect(result.map((i) => i.id)).toEqual(['1', '2', '3']);
    expect(result).not.toBe(items);
  });

  it('keeps only entities in namespaces the user can access', () => {
    const result = filterByCaller(items, userInNsA, (i) => i.namespace);
    expect(result.map((i) => i.id)).toEqual(['1']);
  });

  it('drops entities with no namespace for user callers', () => {
    const result = filterByCaller<Item>([{ id: 'x' }], userInNsA, (i) => i.namespace);
    expect(result).toEqual([]);
  });
});
