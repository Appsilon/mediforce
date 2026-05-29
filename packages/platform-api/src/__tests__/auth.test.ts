import { describe, it, expect } from 'vitest';
import {
  assertNamespaceAccess,
  assertCallerCanAdminDockerImages,
  assertCallerIsNamespaceAdmin,
  callerCanAccess,
  filterByCaller,
  type CallerIdentity,
} from '../auth';
import { ForbiddenError } from '../errors';

const apiKey: CallerIdentity = { kind: 'apiKey', isSystemActor: true };
const userInNsA: CallerIdentity = {
  kind: 'user',
  uid: 'u-1',
  namespaces: new Set(['ns-a']),
  namespaceRoles: new Map([['ns-a', 'member']]),
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

describe('assertCallerIsNamespaceAdmin', () => {
  function user(roles: ReadonlyArray<readonly [string, 'owner' | 'admin' | 'member']>): CallerIdentity {
    return {
      kind: 'user',
      uid: 'u',
      namespaces: new Set(roles.map(([handle]) => handle)),
      namespaceRoles: new Map(roles),
      isSystemActor: false,
    };
  }

  it('bypasses for apiKey callers (trusted infra)', () => {
    expect(() => assertCallerIsNamespaceAdmin(apiKey, 'ns-a')).not.toThrow();
  });

  it('allows users with owner role', () => {
    expect(() => assertCallerIsNamespaceAdmin(user([['ns-a', 'owner']]), 'ns-a')).not.toThrow();
  });

  it('allows users with admin role', () => {
    expect(() => assertCallerIsNamespaceAdmin(user([['ns-a', 'admin']]), 'ns-a')).not.toThrow();
  });

  it('throws ForbiddenError for users with only member role', () => {
    expect(() => assertCallerIsNamespaceAdmin(user([['ns-a', 'member']]), 'ns-a')).toThrow(ForbiddenError);
  });

  it('throws ForbiddenError for users with no role in the namespace', () => {
    expect(() => assertCallerIsNamespaceAdmin(user([['ns-a', 'admin']]), 'ns-b')).toThrow(ForbiddenError);
  });
});

describe('assertCallerCanAdminDockerImages', () => {
  function user(roles: ReadonlyArray<readonly [string, 'owner' | 'admin' | 'member']>): CallerIdentity {
    return {
      kind: 'user',
      uid: 'u',
      namespaces: new Set(roles.map(([handle]) => handle)),
      namespaceRoles: new Map(roles),
      isSystemActor: false,
    };
  }

  it('bypasses for apiKey callers', () => {
    expect(() => assertCallerCanAdminDockerImages(apiKey)).not.toThrow();
  });

  it('allows a user who is owner in any namespace', () => {
    expect(() =>
      assertCallerCanAdminDockerImages(user([['ns-a', 'member'], ['ns-b', 'owner']])),
    ).not.toThrow();
  });

  it('allows a user who is admin in any namespace', () => {
    expect(() =>
      assertCallerCanAdminDockerImages(user([['ns-a', 'admin']])),
    ).not.toThrow();
  });

  it('rejects a user who is only member everywhere', () => {
    expect(() =>
      assertCallerCanAdminDockerImages(user([['ns-a', 'member'], ['ns-b', 'member']])),
    ).toThrow(ForbiddenError);
  });

  it('rejects a user with no memberships at all', () => {
    expect(() => assertCallerCanAdminDockerImages(user([]))).toThrow(ForbiddenError);
  });
});
