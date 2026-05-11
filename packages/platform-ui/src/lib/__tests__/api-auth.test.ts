import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const mockVerifyIdToken = vi.fn();
const mockGetNamespacesByUser = vi.fn();
const mockGetByKeyHash = vi.fn();
const mockTouchLastUsed = vi.fn();

vi.mock('@mediforce/platform-infra', () => ({
  getAdminAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
  hashApiKey: (key: string) => `hash_${key}`,
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

const fakeApiKeyRepo = {
  getByKeyHash: mockGetByKeyHash,
  touchLastUsed: mockTouchLastUsed,
} as never;

function makeRequest(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/test', { headers });
}

describe('resolveCallerIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTouchLastUsed.mockResolvedValue(undefined);
    process.env.PLATFORM_API_KEY = 'test-api-key';
  });

  it('returns apiKey identity for valid global API key', async () => {
    const result = await resolveCallerIdentity(
      makeRequest({ 'X-Api-Key': 'test-api-key' }),
      fakeNamespaceRepo,
      fakeApiKeyRepo,
    );
    expect(result).toEqual({ kind: 'apiKey' });
  });

  it('returns 401 for missing auth', async () => {
    const result = await resolveCallerIdentity(
      makeRequest({}),
      fakeNamespaceRepo,
      fakeApiKeyRepo,
    );
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it('returns 401 for invalid token', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'));
    const result = await resolveCallerIdentity(
      makeRequest({ Authorization: 'Bearer bad-token' }),
      fakeNamespaceRepo,
      fakeApiKeyRepo,
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
      fakeApiKeyRepo,
    );

    expect(result).toEqual({
      kind: 'user',
      uid: 'user-1',
      namespaces: new Set(['org-a', 'org-b']),
    });
  });

  it('rejects wrong API key and falls through to token check', async () => {
    const result = await resolveCallerIdentity(
      makeRequest({ 'X-Api-Key': 'wrong-key' }),
      fakeNamespaceRepo,
      fakeApiKeyRepo,
    );
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it('resolves mf_ key to user identity', async () => {
    mockGetByKeyHash.mockResolvedValue({
      id: 'key-1',
      userId: 'uid-42',
      keyHash: 'hash_mf_valid',
      keyPrefix: 'mf_valid',
      label: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    mockGetNamespacesByUser.mockResolvedValue([{ handle: 'my-ns' }]);

    const result = await resolveCallerIdentity(
      makeRequest({ 'X-Api-Key': 'mf_valid' }),
      fakeNamespaceRepo,
      fakeApiKeyRepo,
    );

    expect(result).toEqual({
      kind: 'user',
      uid: 'uid-42',
      namespaces: new Set(['my-ns']),
    });
    expect(mockGetByKeyHash).toHaveBeenCalledWith('hash_mf_valid');
  });

  it('returns 401 for invalid mf_ key', async () => {
    mockGetByKeyHash.mockResolvedValue(null);

    const result = await resolveCallerIdentity(
      makeRequest({ 'X-Api-Key': 'mf_nonexistent' }),
      fakeNamespaceRepo,
      fakeApiKeyRepo,
    );

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
    const body = await (result as NextResponse).json();
    expect(body.error).toMatch(/Invalid or revoked/);
  });

  it('returns 401 for revoked mf_ key', async () => {
    mockGetByKeyHash.mockResolvedValue({
      id: 'key-2',
      userId: 'uid-42',
      keyHash: 'hash_mf_revoked',
      keyPrefix: 'mf_revoke',
      label: 'old',
      createdAt: '2026-01-01T00:00:00.000Z',
      revokedAt: '2026-05-01T00:00:00.000Z',
    });

    const result = await resolveCallerIdentity(
      makeRequest({ 'X-Api-Key': 'mf_revoked' }),
      fakeNamespaceRepo,
      fakeApiKeyRepo,
    );

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
    const body = await (result as NextResponse).json();
    expect(body.error).toMatch(/Invalid or revoked/);
  });

  it('global key takes priority over mf_ prefix', async () => {
    process.env.PLATFORM_API_KEY = 'mf_global_key';
    const result = await resolveCallerIdentity(
      makeRequest({ 'X-Api-Key': 'mf_global_key' }),
      fakeNamespaceRepo,
      fakeApiKeyRepo,
    );
    expect(result).toEqual({ kind: 'apiKey' });
    expect(mockGetByKeyHash).not.toHaveBeenCalled();
  });
});

describe('callerCanAccess', () => {
  it('apiKey can access any namespace', () => {
    expect(callerCanAccess({ kind: 'apiKey' }, 'any-ns')).toBe(true);
  });

  it('user can access own namespace', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['my-ns']) };
    expect(callerCanAccess(caller, 'my-ns')).toBe(true);
  });

  it('user cannot access other namespace', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['my-ns']) };
    expect(callerCanAccess(caller, 'other-ns')).toBe(false);
  });
});

describe('requireNamespaceAccess', () => {
  it('returns null for apiKey', () => {
    expect(requireNamespaceAccess({ kind: 'apiKey' }, 'any')).toBeNull();
  });

  it('returns null for member', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['ns']) };
    expect(requireNamespaceAccess(caller, 'ns')).toBeNull();
  });

  it('returns 403 for non-member', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['ns']) };
    const result = requireNamespaceAccess(caller, 'other-ns');
    expect(result).toBeInstanceOf(NextResponse);
    expect(result!.status).toBe(403);
  });

  it('returns 403 for undefined namespace', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['ns']) };
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
    expect(filterByNamespace({ kind: 'apiKey' }, items)).toEqual(items);
  });

  it('user sees only own namespace', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['org-a']) };
    expect(filterByNamespace(caller, items)).toEqual([
      { namespace: 'org-a', name: 'wf-1' },
      { namespace: 'org-a', name: 'wf-3' },
    ]);
  });

  it('user with no matching namespace sees nothing', () => {
    const caller: CallerIdentity = { kind: 'user', uid: 'u1', namespaces: new Set(['org-c']) };
    expect(filterByNamespace(caller, items)).toEqual([]);
  });
});
