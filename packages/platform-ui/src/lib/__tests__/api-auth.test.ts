import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const mockResolveSessionUserId = vi.fn();
const mockGetMembershipsForUser = vi.fn();

vi.mock('@mediforce/platform-infra', () => ({
  getSharedPostgresClient: () => ({ db: {} }),
  resolveSessionUserId: (...args: unknown[]) => mockResolveSessionUserId(...args),
}));

const SESSION_COOKIE = { cookie: 'authjs.session-token=session-token-abc' };

import {
  resolveCallerIdentity,
  callerCanAccess,
  requireNamespaceAccess,
  filterByNamespace,
  type CallerIdentity,
} from '../api-auth';

const fakeNamespaceRepo = {
  getMembershipsForUser: mockGetMembershipsForUser,
} as never;

function makeRequest(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/test', { headers });
}

describe('resolveCallerIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PLATFORM_API_KEY = 'test-api-key';
    delete process.env.PLATFORM_ADMIN_API_KEY;
  });

  it('returns apiKey identity for valid PLATFORM_API_KEY', async () => {
    const result = await resolveCallerIdentity(
      makeRequest({ 'X-Api-Key': 'test-api-key' }),
      fakeNamespaceRepo,
    );
    expect(result).toEqual({ kind: 'apiKey', isSystemActor: true });
  });

  it('accepts PLATFORM_ADMIN_API_KEY and mints the same apiKey shape as PLATFORM_API_KEY', async () => {
    process.env.PLATFORM_ADMIN_API_KEY = 'admin-key';
    const result = await resolveCallerIdentity(
      makeRequest({ 'X-Api-Key': 'admin-key' }),
      fakeNamespaceRepo,
    );
    expect(result).toEqual({ kind: 'apiKey', isSystemActor: true });
  });

  it('returns 401 for missing auth', async () => {
    const result = await resolveCallerIdentity(
      makeRequest({}),
      fakeNamespaceRepo,
    );
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it('returns 401 for an invalid/expired session cookie', async () => {
    mockResolveSessionUserId.mockResolvedValue(null);
    const result = await resolveCallerIdentity(
      makeRequest(SESSION_COOKIE),
      fakeNamespaceRepo,
    );
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it('returns user identity with namespaces + roles populated from getMembershipsForUser', async () => {
    mockResolveSessionUserId.mockResolvedValue('user-1');
    mockGetMembershipsForUser.mockResolvedValue([
      { handle: 'org-a', role: 'owner' },
      { handle: 'org-b', role: 'admin' },
      { handle: 'org-c', role: 'member' },
    ]);

    const result = await resolveCallerIdentity(
      makeRequest(SESSION_COOKIE),
      fakeNamespaceRepo,
    );

    expect(result).toEqual({
      kind: 'user',
      uid: 'user-1',
      namespaces: new Set(['org-a', 'org-b', 'org-c']),
      namespaceRoles: new Map([
        ['org-a', 'owner'],
        ['org-b', 'admin'],
        ['org-c', 'member'],
      ]),
      isSystemActor: false,
    });
  });

  it('rejects wrong API key and falls through to the session check', async () => {
    const result = await resolveCallerIdentity(
      makeRequest({ 'X-Api-Key': 'wrong-key' }),
      fakeNamespaceRepo,
    );
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });
});

describe('callerCanAccess', () => {
  it('apiKey can access any namespace', () => {
    expect(callerCanAccess({ kind: 'apiKey', isSystemActor: true }, 'any-ns')).toBe(true);
  });

  it('user can access own namespace', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['my-ns']), namespaceRoles: new Map([['my-ns', 'member']]), isSystemActor: false };
    expect(callerCanAccess(caller, 'my-ns')).toBe(true);
  });

  it('user cannot access other namespace', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['my-ns']), namespaceRoles: new Map([['my-ns', 'member']]), isSystemActor: false };
    expect(callerCanAccess(caller, 'other-ns')).toBe(false);
  });
});

describe('requireNamespaceAccess', () => {
  it('returns null for apiKey', () => {
    expect(requireNamespaceAccess({ kind: 'apiKey', isSystemActor: true }, 'any')).toBeNull();
  });

  it('returns null for member', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['ns']), namespaceRoles: new Map([['ns', 'member']]), isSystemActor: false };
    expect(requireNamespaceAccess(caller, 'ns')).toBeNull();
  });

  it('returns 403 for non-member', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['ns']), namespaceRoles: new Map([['ns', 'member']]), isSystemActor: false };
    const result = requireNamespaceAccess(caller, 'other-ns');
    expect(result).toBeInstanceOf(NextResponse);
    expect(result!.status).toBe(403);
  });

  it('returns 403 for undefined namespace', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['ns']), namespaceRoles: new Map([['ns', 'member']]), isSystemActor: false };
    const result = requireNamespaceAccess(caller, undefined);
    expect(result).toBeInstanceOf(NextResponse);
    expect(result!.status).toBe(403);
  });
});

describe('filterByNamespace', () => {
  const items = [
    { namespace: 'org-a', name: 'wf-1' },
    { namespace: 'org-b', name: 'wf-2' },
    { namespace: 'org-a', name: 'wf-3' },
  ];

  it('apiKey returns all', () => {
    expect(filterByNamespace({ kind: 'apiKey', isSystemActor: true }, items)).toEqual(items);
  });

  it('user sees only own namespace', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['org-a']), namespaceRoles: new Map([['org-a', 'member']]), isSystemActor: false };
    expect(filterByNamespace(caller, items)).toEqual([
      { namespace: 'org-a', name: 'wf-1' },
      { namespace: 'org-a', name: 'wf-3' },
    ]);
  });

  it('user with no matching namespace sees nothing', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['org-c']), namespaceRoles: new Map([['org-c', 'member']]), isSystemActor: false };
    expect(filterByNamespace(caller, items)).toEqual([]);
  });
});
