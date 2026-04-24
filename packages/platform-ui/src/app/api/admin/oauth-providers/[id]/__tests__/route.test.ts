import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockVerifyIdToken = vi.fn();
const mockNamespaceGet = vi.fn();
const mockGetMember = vi.fn();
const mockProviderGet = vi.fn();
const mockProviderUpdate = vi.fn();
const mockProviderDelete = vi.fn();

vi.mock('@mediforce/platform-infra', () => ({
  getAdminAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    namespaceRepo: {
      getNamespace: mockNamespaceGet,
      getMember: mockGetMember,
    },
    oauthProviderRepo: {
      get: mockProviderGet,
      update: mockProviderUpdate,
      delete: mockProviderDelete,
    },
  }),
}));

import { GET, PATCH, DELETE } from '../route';

// ---- Helpers ----

const makeParams = (id: string) => Promise.resolve({ id });

function authedHeaders(authHeader: string | null = 'Bearer valid-token'): Record<string, string> {
  const headers: Record<string, string> = {};
  if (authHeader !== null) headers.Authorization = authHeader;
  return headers;
}

function makeGetRequest(
  id: string,
  namespace?: string,
  authHeader: string | null = 'Bearer valid-token',
): NextRequest {
  const url = new URL(`http://localhost/api/admin/oauth-providers/${id}`);
  if (namespace !== undefined) url.searchParams.set('namespace', namespace);
  return new NextRequest(url.toString(), { headers: authedHeaders(authHeader) });
}

function makePatchRequest(
  id: string,
  namespace: string | null,
  body: unknown,
  authHeader: string | null = 'Bearer valid-token',
): NextRequest {
  const url = new URL(`http://localhost/api/admin/oauth-providers/${id}`);
  if (namespace !== null) url.searchParams.set('namespace', namespace);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authedHeaders(authHeader),
  };
  return new NextRequest(url.toString(), {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(
  id: string,
  namespace?: string,
  authHeader: string | null = 'Bearer valid-token',
): NextRequest {
  const url = new URL(`http://localhost/api/admin/oauth-providers/${id}`);
  if (namespace !== undefined) url.searchParams.set('namespace', namespace);
  return new NextRequest(url.toString(), {
    method: 'DELETE',
    headers: authedHeaders(authHeader),
  });
}

const existingNamespace = {
  handle: 'appsilon',
  type: 'organization',
  displayName: 'Appsilon',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const adminMember = {
  uid: 'uid-admin',
  role: 'admin' as const,
  joinedAt: '2026-01-01T00:00:00.000Z',
};

const plainMember = { ...adminMember, role: 'member' as const };

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

function setupAdminAuth(): void {
  vi.clearAllMocks();
  mockVerifyIdToken.mockResolvedValue({ uid: 'uid-admin' });
  mockNamespaceGet.mockResolvedValue(existingNamespace);
  mockGetMember.mockResolvedValue(adminMember);
}

// ---- GET ----

describe('GET /api/admin/oauth-providers/:id', () => {
  beforeEach(setupAdminAuth);

  it('[DATA] returns provider by id', async () => {
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

  it('[SECURITY] single-get response strips clientSecret', async () => {
    mockProviderGet.mockResolvedValue(providerConfig);

    const res = await GET(
      makeGetRequest('github', 'appsilon'),
      { params: makeParams('github') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.provider).not.toHaveProperty('clientSecret');
    expect(JSON.stringify(json)).not.toContain('client-secret-xyz');
  });

  it('[ERROR] 400 when namespace missing', async () => {
    const res = await GET(
      makeGetRequest('github'),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(400);
    expect(mockProviderGet).not.toHaveBeenCalled();
  });

  it('[ERROR] 404 when namespace does not exist', async () => {
    mockNamespaceGet.mockResolvedValue(null);

    const res = await GET(
      makeGetRequest('github', 'nope'),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(404);
    expect(mockProviderGet).not.toHaveBeenCalled();
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
    mockGetMember.mockResolvedValue(plainMember);

    const res = await GET(
      makeGetRequest('github', 'appsilon'),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(403);
    expect(mockProviderGet).not.toHaveBeenCalled();
  });

  it('[AUTHZ] missing auth header gets 401', async () => {
    const res = await GET(
      makeGetRequest('github', 'appsilon', null),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(401);
    expect(mockProviderGet).not.toHaveBeenCalled();
  });
});

// ---- PATCH ----

describe('PATCH /api/admin/oauth-providers/:id', () => {
  beforeEach(setupAdminAuth);

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

  it('[SECURITY] PATCH response strips clientSecret', async () => {
    mockProviderUpdate.mockResolvedValue(providerConfig);

    const res = await PATCH(
      makePatchRequest('github', 'appsilon', { name: 'GitHub Enterprise' }),
      { params: makeParams('github') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.provider).not.toHaveProperty('clientSecret');
    expect(JSON.stringify(json)).not.toContain('client-secret-xyz');
  });

  it('[DATA] accepts partial scopes update', async () => {
    const patched = { ...providerConfig, scopes: ['repo'] };
    mockProviderUpdate.mockResolvedValue(patched);

    const res = await PATCH(
      makePatchRequest('github', 'appsilon', { scopes: ['repo'] }),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.provider.scopes).toEqual(['repo']);
  });

  it('[ERROR] 400 on invalid URL in patch', async () => {
    const res = await PATCH(
      makePatchRequest('github', 'appsilon', { tokenUrl: 'not-a-url' }),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(400);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 when body is not an object', async () => {
    const url = new URL('http://localhost/api/admin/oauth-providers/github?namespace=appsilon');
    const req = new NextRequest(url.toString(), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: 'not-json',
    });

    const res = await PATCH(req, { params: makeParams('github') });
    expect(res.status).toBe(400);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 when patch tries to rename id (strict schema)', async () => {
    const res = await PATCH(
      makePatchRequest('github', 'appsilon', { id: 'renamed' }),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(400);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });

  it('[ERROR] 404 when provider does not exist', async () => {
    mockProviderUpdate.mockResolvedValue(null);

    const res = await PATCH(
      makePatchRequest('missing', 'appsilon', { name: 'X' }),
      { params: makeParams('missing') },
    );
    expect(res.status).toBe(404);
  });

  it('[ERROR] 404 when namespace missing', async () => {
    mockNamespaceGet.mockResolvedValue(null);

    const res = await PATCH(
      makePatchRequest('github', 'nope', { name: 'X' }),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(404);
  });

  it('[AUTHZ] plain member gets 403', async () => {
    mockGetMember.mockResolvedValue(plainMember);

    const res = await PATCH(
      makePatchRequest('github', 'appsilon', { name: 'X' }),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(403);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });
});

// ---- DELETE ----

describe('DELETE /api/admin/oauth-providers/:id', () => {
  beforeEach(setupAdminAuth);

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
    expect(mockProviderDelete).toHaveBeenCalledWith('appsilon', 'missing');
  });

  it('[ERROR] 400 when namespace missing', async () => {
    const res = await DELETE(
      makeDeleteRequest('github'),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(400);
    expect(mockProviderDelete).not.toHaveBeenCalled();
  });

  it('[ERROR] 404 when namespace does not exist', async () => {
    mockNamespaceGet.mockResolvedValue(null);

    const res = await DELETE(
      makeDeleteRequest('github', 'nope'),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(404);
    expect(mockProviderDelete).not.toHaveBeenCalled();
  });

  it('[AUTHZ] plain member gets 403', async () => {
    mockGetMember.mockResolvedValue(plainMember);

    const res = await DELETE(
      makeDeleteRequest('github', 'appsilon'),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(403);
    expect(mockProviderDelete).not.toHaveBeenCalled();
  });

  it('[AUTHZ] non-member gets 403', async () => {
    mockGetMember.mockResolvedValue(null);

    const res = await DELETE(
      makeDeleteRequest('github', 'appsilon'),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(403);
    expect(mockProviderDelete).not.toHaveBeenCalled();
  });
});
