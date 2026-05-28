import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route smoke for the [id] adapter. Handler behaviour is covered by L2
// handler tests in packages/platform-api/src/handlers/oauth-providers/__tests__/.
// This file only proves the dynamic-segment params + query namespace get
// stitched into the input shape correctly.

const mockProviderGet = vi.fn();
const mockProviderUpdate = vi.fn();
const mockProviderDelete = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    oauthProviderRepo: {
      list: vi.fn(),
      get: mockProviderGet,
      create: vi.fn(),
      update: mockProviderUpdate,
      delete: mockProviderDelete,
    },
    auditRepo: { append: mockAuditAppend },
    instanceRepo: { getById: vi.fn() },
    namespaceRepo: {},
  }),
  getAppBaseUrl: () => 'http://localhost:3000',
}));

const mockResolveCallerIdentity = vi.fn();

vi.mock('@/lib/api-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth')>('@/lib/api-auth');
  return {
    ...actual,
    resolveCallerIdentity: (...args: unknown[]) => mockResolveCallerIdentity(...args),
  };
});

import { GET, PATCH, DELETE } from '../route';

const providerConfig = {
  id: 'github',
  name: 'GitHub',
  clientId: 'client-id-xyz',
  clientSecret: 'client-secret-xyz',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  userInfoUrl: 'https://api.github.com/user',
  scopes: ['repo', 'read:user'],
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
};

function adminCaller(handle = 'appsilon') {
  return {
    kind: 'user' as const,
    uid: 'uid-admin',
    namespaces: new Set([handle]),
    namespaceRoles: new Map([[handle, 'admin' as const]]),
    isSystemActor: false as const,
  };
}

function memberCaller(handle = 'appsilon') {
  return {
    kind: 'user' as const,
    uid: 'uid-member',
    namespaces: new Set([handle]),
    namespaceRoles: new Map([[handle, 'member' as const]]),
    isSystemActor: false as const,
  };
}

const makeParams = (id: string) => Promise.resolve({ id });

function makeGetRequest(id: string, namespace?: string): NextRequest {
  const url = new URL(`http://localhost/api/admin/oauth-providers/${id}`);
  if (namespace !== undefined) url.searchParams.set('namespace', namespace);
  return new NextRequest(url.toString());
}

function makePatchRequest(id: string, namespace: string | null, body: unknown): NextRequest {
  const url = new URL(`http://localhost/api/admin/oauth-providers/${id}`);
  if (namespace !== null) url.searchParams.set('namespace', namespace);
  return new NextRequest(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(id: string, namespace?: string): NextRequest {
  const url = new URL(`http://localhost/api/admin/oauth-providers/${id}`);
  if (namespace !== undefined) url.searchParams.set('namespace', namespace);
  return new NextRequest(url.toString(), { method: 'DELETE' });
}

describe('GET /api/admin/oauth-providers/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockResolvedValue(adminCaller());
  });

  it('[DATA] returns provider by id (wiring smoke)', async () => {
    mockProviderGet.mockResolvedValue(providerConfig);

    const res = await GET(
      makeGetRequest('github', 'appsilon'),
      { params: makeParams('github') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.provider.id).toBe('github');
    expect(mockProviderGet).toHaveBeenCalledWith('appsilon', 'github');
  });

  it('[SECURITY] strips clientSecret', async () => {
    mockProviderGet.mockResolvedValue(providerConfig);

    const res = await GET(
      makeGetRequest('github', 'appsilon'),
      { params: makeParams('github') },
    );
    const json = await res.json();

    expect(json.provider).not.toHaveProperty('clientSecret');
    expect(JSON.stringify(json)).not.toContain('client-secret-xyz');
  });

  it('[ERROR] 404 when provider not found', async () => {
    mockProviderGet.mockResolvedValue(null);

    const res = await GET(
      makeGetRequest('missing', 'appsilon'),
      { params: makeParams('missing') },
    );

    expect(res.status).toBe(404);
  });

  it('[AUTHZ] plain member gets 403', async () => {
    mockResolveCallerIdentity.mockResolvedValue(memberCaller());

    const res = await GET(
      makeGetRequest('github', 'appsilon'),
      { params: makeParams('github') },
    );

    expect(res.status).toBe(403);
    expect(mockProviderGet).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/oauth-providers/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockResolvedValue(adminCaller());
    mockAuditAppend.mockResolvedValue(undefined);
  });

  it('[DATA] updates fields returned from repo', async () => {
    const patched = { ...providerConfig, name: 'GitHub Enterprise' };
    mockProviderUpdate.mockResolvedValue(patched);

    const res = await PATCH(
      makePatchRequest('github', 'appsilon', { name: 'GitHub Enterprise' }),
      { params: makeParams('github') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.provider.name).toBe('GitHub Enterprise');
    expect(mockProviderUpdate).toHaveBeenCalledWith('appsilon', 'github', {
      name: 'GitHub Enterprise',
    });
  });

  it('[ERROR] 404 when provider does not exist', async () => {
    mockProviderUpdate.mockResolvedValue(null);

    const res = await PATCH(
      makePatchRequest('missing', 'appsilon', { name: 'X' }),
      { params: makeParams('missing') },
    );

    expect(res.status).toBe(404);
  });

  it('[CANONICAL] path id wins over body id (rename attempt is silently ignored)', async () => {
    // The route adapter merges the body, then overrides `id` with the path
    // segment — so `{ id: 'renamed' }` in the body never reaches the repo as
    // a rename. UpdateOAuthProviderInputSchema already strips `id` from the
    // partial-patch, but the API input schema reinstates it from the path.
    mockProviderUpdate.mockResolvedValue({ ...providerConfig, name: providerConfig.name });

    const res = await PATCH(
      makePatchRequest('github', 'appsilon', { id: 'renamed', name: 'X' }),
      { params: makeParams('github') },
    );

    expect(res.status).toBe(200);
    expect(mockProviderUpdate).toHaveBeenCalledWith('appsilon', 'github', { name: 'X' });
  });

  it('[AUTHZ] plain member gets 403', async () => {
    mockResolveCallerIdentity.mockResolvedValue(memberCaller());

    const res = await PATCH(
      makePatchRequest('github', 'appsilon', { name: 'X' }),
      { params: makeParams('github') },
    );

    expect(res.status).toBe(403);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/oauth-providers/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockResolvedValue(adminCaller());
    mockAuditAppend.mockResolvedValue(undefined);
  });

  it('[DATA] deletes an existing provider', async () => {
    mockProviderDelete.mockResolvedValue(true);

    const res = await DELETE(
      makeDeleteRequest('github', 'appsilon'),
      { params: makeParams('github') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockProviderDelete).toHaveBeenCalledWith('appsilon', 'github');
  });

  it('[DATA] idempotent — 200 even when provider does not exist', async () => {
    mockProviderDelete.mockResolvedValue(false);

    const res = await DELETE(
      makeDeleteRequest('missing', 'appsilon'),
      { params: makeParams('missing') },
    );

    expect(res.status).toBe(200);
  });

  it('[AUTHZ] plain member gets 403', async () => {
    mockResolveCallerIdentity.mockResolvedValue(memberCaller());

    const res = await DELETE(
      makeDeleteRequest('github', 'appsilon'),
      { params: makeParams('github') },
    );

    expect(res.status).toBe(403);
    expect(mockProviderDelete).not.toHaveBeenCalled();
  });
});
