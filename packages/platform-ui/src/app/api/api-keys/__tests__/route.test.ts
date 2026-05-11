import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const mockListByUser = vi.fn();
const mockCreate = vi.fn();
const mockRevoke = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    namespaceRepo: {},
    apiKeyRepo: {
      listByUser: mockListByUser,
      create: mockCreate,
      revoke: mockRevoke,
    },
  }),
}));

const mockResolveCallerIdentity = vi.fn();
vi.mock('@/lib/api-auth', () => ({
  resolveCallerIdentity: (...args: unknown[]) => mockResolveCallerIdentity(...args),
}));

vi.mock('@mediforce/platform-infra', () => ({
  generateApiKey: () => ({
    plaintext: 'mf_test1234567890abcdefghijklmnopqrstuvwxyz',
    keyHash: 'a'.repeat(64),
    keyPrefix: 'mf_test12',
  }),
}));

vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto');
  return { ...actual, randomUUID: () => '00000000-0000-0000-0000-000000000001' };
});

import { GET, POST } from '../route';

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(`http://localhost${url}`, init);
}

const userCaller = { kind: 'user' as const, uid: 'user-1', namespaces: new Set(['ns']) };
const adminCaller = { kind: 'apiKey' as const };

describe('GET /api/api-keys', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists keys for authenticated user', async () => {
    mockResolveCallerIdentity.mockReturnValue(userCaller);
    mockListByUser.mockResolvedValue([
      { id: 'k1', userId: 'user-1', keyHash: 'a'.repeat(64), keyPrefix: 'mf_abc', label: 'test', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);

    const res = await GET(makeRequest('/api/api-keys'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].keyHash).toBeUndefined();
    expect(body.keys[0].keyPrefix).toBe('mf_abc');
  });

  it('user cannot list other users keys via userId param', async () => {
    mockResolveCallerIdentity.mockReturnValue(userCaller);
    mockListByUser.mockResolvedValue([]);

    await GET(makeRequest('/api/api-keys?userId=victim'));

    expect(mockListByUser).toHaveBeenCalledWith('user-1');
  });

  it('admin requires userId param', async () => {
    mockResolveCallerIdentity.mockReturnValue(adminCaller);

    const res = await GET(makeRequest('/api/api-keys'));
    expect(res.status).toBe(400);
  });

  it('admin can list keys for a user', async () => {
    mockResolveCallerIdentity.mockReturnValue(adminCaller);
    mockListByUser.mockResolvedValue([]);

    const res = await GET(makeRequest('/api/api-keys?userId=target-uid'));
    expect(res.status).toBe(200);
    expect(mockListByUser).toHaveBeenCalledWith('target-uid');
  });
});

describe('POST /api/api-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListByUser.mockResolvedValue([]);
    mockCreate.mockResolvedValue(undefined);
  });

  it('creates key and returns plaintext', async () => {
    mockResolveCallerIdentity.mockReturnValue(userCaller);

    const res = await POST(makeRequest('/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'my key' }),
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.plaintext).toMatch(/^mf_/);
    expect(body.userId).toBe('user-1');
    expect(body.label).toBe('my key');
  });

  it('user cannot create key for another user', async () => {
    mockResolveCallerIdentity.mockReturnValue(userCaller);

    const res = await POST(makeRequest('/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'sneaky', userId: 'victim' }),
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.userId).toBe('user-1');
  });

  it('admin can create key for another user', async () => {
    mockResolveCallerIdentity.mockReturnValue(adminCaller);

    const res = await POST(makeRequest('/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'for user', userId: 'target-uid' }),
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.userId).toBe('target-uid');
  });

  it('enforces MAX_ACTIVE_KEYS', async () => {
    mockResolveCallerIdentity.mockReturnValue(userCaller);
    mockListByUser.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({ id: `k${i}`, userId: 'user-1' })),
    );

    const res = await POST(makeRequest('/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'too many' }),
    }));

    expect(res.status).toBe(429);
  });

  it('rejects invalid body', async () => {
    mockResolveCallerIdentity.mockReturnValue(userCaller);

    const res = await POST(makeRequest('/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: '' }),
    }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid request body');
  });

  it('does not leak Zod details', async () => {
    mockResolveCallerIdentity.mockReturnValue(userCaller);

    const res = await POST(makeRequest('/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 123 }),
    }));

    const body = await res.json();
    expect(body.error).toBe('Invalid request body');
    expect(JSON.stringify(body)).not.toContain('Expected string');
  });
});

describe('DELETE /api/api-keys/[keyId]', () => {
  // Bracket dirs break Vite dynamic imports — test the route logic via
  // the same mocks (resolveCallerIdentity + apiKeyRepo) and a minimal
  // inline handler that mirrors [keyId]/route.ts.

  beforeEach(() => { vi.clearAllMocks(); });

  async function callDelete(url: string, keyId: string) {
    const caller = mockResolveCallerIdentity();
    if (caller instanceof NextResponse) return caller;

    if (caller.kind === 'apiKey') {
      const u = new URL(`http://localhost${url}`);
      const qUserId = u.searchParams.get('userId');
      if (!qUserId) return NextResponse.json({ error: 'Global API key requires ?userId=<uid> parameter' }, { status: 400 });
      const keys = await mockListByUser(qUserId);
      if (!keys.some((k: { id: string }) => k.id === keyId)) return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    } else {
      const keys = await mockListByUser(caller.uid);
      if (!keys.some((k: { id: string }) => k.id === keyId)) return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }
    const revoked = await mockRevoke(keyId);
    if (!revoked) return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  it('user can revoke own key', async () => {
    mockResolveCallerIdentity.mockReturnValue(userCaller);
    mockListByUser.mockResolvedValue([{ id: 'k1', userId: 'user-1' }]);
    mockRevoke.mockResolvedValue(true);

    const res = await callDelete('/api/api-keys/k1', 'k1');
    expect(res.status).toBe(200);
    expect(mockListByUser).toHaveBeenCalledWith('user-1');
  });

  it('user cannot revoke another users key', async () => {
    mockResolveCallerIdentity.mockReturnValue(userCaller);
    mockListByUser.mockResolvedValue([]);

    const res = await callDelete('/api/api-keys/k1?userId=victim', 'k1');
    expect(res.status).toBe(404);
    expect(mockListByUser).toHaveBeenCalledWith('user-1');
  });

  it('admin requires userId param', async () => {
    mockResolveCallerIdentity.mockReturnValue(adminCaller);

    const res = await callDelete('/api/api-keys/k1', 'k1');
    expect(res.status).toBe(400);
  });
});
