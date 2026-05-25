import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const mockVerifyIdToken = vi.fn();
const mockGetNamespacesByUser = vi.fn();

vi.mock('@mediforce/platform-infra', () => ({
  getAdminAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

import {
  resolveCallerIdentity,
  callerCanAccess,
  requireNamespaceAccess,
  filterByNamespace,
  type CallerIdentity,
} from '../api-auth';

const fakeNamespaceRepo = {
  getNamespacesByUser: mockGetNamespacesByUser,
} as never;

function makeRequest(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/test', { headers });
}

describe('resolveCallerIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PLATFORM_API_KEY = 'test-api-key';
  });

  it('returns apiKey identity for valid API key', async () => {
    const result = await resolveCallerIdentity(
      makeRequest({ 'X-Api-Key': 'test-api-key' }),
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

  it('returns 401 for invalid token', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'));
    const result = await resolveCallerIdentity(
      makeRequest({ Authorization: 'Bearer bad-token' }),
      fakeNamespaceRepo,
    );
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it('returns user identity with namespace set for valid token', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1' });
    mockGetNamespacesByUser.mockResolvedValue([
      { handle: 'org-a' },
      { handle: 'org-b' },
    ]);

    const result = await resolveCallerIdentity(
      makeRequest({ Authorization: 'Bearer valid-token' }),
      fakeNamespaceRepo,
    );

    expect(result).toEqual({
      kind: 'user',
      uid: 'user-1',
      namespaces: new Set(['org-a', 'org-b']),
      isSystemActor: false,
    });
  });

  it('rejects wrong API key and falls through to token check', async () => {
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
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['my-ns']), isSystemActor: false };
    expect(callerCanAccess(caller, 'my-ns')).toBe(true);
  });

  it('user cannot access other namespace', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['my-ns']), isSystemActor: false };
    expect(callerCanAccess(caller, 'other-ns')).toBe(false);
  });
});

describe('requireNamespaceAccess', () => {
  it('returns null for apiKey', () => {
    expect(requireNamespaceAccess({ kind: 'apiKey', isSystemActor: true }, 'any')).toBeNull();
  });

  it('returns null for member', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['ns']), isSystemActor: false };
    expect(requireNamespaceAccess(caller, 'ns')).toBeNull();
  });

  it('returns 403 for non-member', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['ns']), isSystemActor: false };
    const result = requireNamespaceAccess(caller, 'other-ns');
    expect(result).toBeInstanceOf(NextResponse);
    expect(result!.status).toBe(403);
  });

  it('returns 403 for undefined namespace', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['ns']), isSystemActor: false };
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
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['org-a']), isSystemActor: false };
    expect(filterByNamespace(caller, items)).toEqual([
      { namespace: 'org-a', name: 'wf-1' },
      { namespace: 'org-a', name: 'wf-3' },
    ]);
  });

  it('user with no matching namespace sees nothing', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['org-c']), isSystemActor: false };
    expect(filterByNamespace(caller, items)).toEqual([]);
  });
});
