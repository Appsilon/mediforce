import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ProviderAlreadyExistsError } from '@mediforce/platform-core';

// ---- Mocks ----

const mockVerifyIdToken = vi.fn();
const mockNamespaceGet = vi.fn();
const mockGetMember = vi.fn();
const mockProviderList = vi.fn();
const mockProviderCreate = vi.fn();

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
      list: mockProviderList,
      create: mockProviderCreate,
    },
  }),
}));

import { GET, POST } from '../route';

// ---- Helpers ----

function makeGetRequest(
  namespace?: string,
  { authHeader = 'Bearer valid-token', apiKey }: { authHeader?: string | null; apiKey?: string } = {},
): NextRequest {
  const url = new URL('http://localhost/api/admin/oauth-providers');
  if (namespace !== undefined) url.searchParams.set('namespace', namespace);
  const headers: Record<string, string> = {};
  if (authHeader !== null) headers.Authorization = authHeader;
  if (apiKey !== undefined) headers['X-Api-Key'] = apiKey;
  return new NextRequest(url.toString(), { headers });
}

function makePostRequest(
  namespace: string | null,
  body: unknown,
  { authHeader = 'Bearer valid-token', apiKey }: { authHeader?: string | null; apiKey?: string } = {},
): NextRequest {
  const url = new URL('http://localhost/api/admin/oauth-providers');
  if (namespace !== null) url.searchParams.set('namespace', namespace);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader !== null) headers.Authorization = authHeader;
  if (apiKey !== undefined) headers['X-Api-Key'] = apiKey;
  return new NextRequest(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
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

const ownerMember = { ...adminMember, role: 'owner' as const };
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

const providerInput = {
  id: 'github',
  name: 'GitHub',
  clientId: 'client-id-xyz',
  clientSecret: 'client-secret-xyz',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  userInfoUrl: 'https://api.github.com/user',
  scopes: ['repo', 'read:user'],
};

// ---- Tests ----

describe('GET /api/admin/oauth-providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: 'uid-admin' });
    mockNamespaceGet.mockResolvedValue(existingNamespace);
    mockGetMember.mockResolvedValue(adminMember);
  });

  it('[DATA] lists providers in a namespace', async () => {
    mockProviderList.mockResolvedValue([providerConfig]);

    const res = await GET(makeGetRequest('appsilon'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.providers).toHaveLength(1);
    expect(json.providers[0].id).toBe('github');
    expect(mockProviderList).toHaveBeenCalledWith('appsilon');
  });

  it('[SECURITY] list response strips clientSecret', async () => {
    mockProviderList.mockResolvedValue([providerConfig]);

    const res = await GET(makeGetRequest('appsilon'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.providers[0]).not.toHaveProperty('clientSecret');
    expect(JSON.stringify(json)).not.toContain('client-secret-xyz');
  });

  it('[DATA] returns empty list when no providers exist', async () => {
    mockProviderList.mockResolvedValue([]);

    const res = await GET(makeGetRequest('appsilon'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.providers).toEqual([]);
  });

  it('[ERROR] 400 when namespace query param is missing', async () => {
    const res = await GET(makeGetRequest());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('namespace');
    expect(mockNamespaceGet).not.toHaveBeenCalled();
    expect(mockProviderList).not.toHaveBeenCalled();
  });

  it('[ERROR] 404 when namespace does not exist', async () => {
    mockNamespaceGet.mockResolvedValue(null);

    const res = await GET(makeGetRequest('nope'));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('nope');
    expect(mockProviderList).not.toHaveBeenCalled();
  });

  it('[ISOLATION] list is scoped to the requested namespace', async () => {
    mockProviderList.mockResolvedValue([providerConfig]);

    await GET(makeGetRequest('other-ns'));
    expect(mockProviderList).toHaveBeenCalledWith('other-ns');
    expect(mockProviderList).not.toHaveBeenCalledWith('appsilon');
  });

  it('[AUTHZ] owner role passes', async () => {
    mockGetMember.mockResolvedValue(ownerMember);
    mockProviderList.mockResolvedValue([]);

    const res = await GET(makeGetRequest('appsilon'));
    expect(res.status).toBe(200);
  });

  it('[AUTHZ] plain member gets 403', async () => {
    mockGetMember.mockResolvedValue(plainMember);

    const res = await GET(makeGetRequest('appsilon'));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain('admin');
    expect(mockProviderList).not.toHaveBeenCalled();
  });

  it('[AUTHZ] non-member gets 403', async () => {
    mockGetMember.mockResolvedValue(null);

    const res = await GET(makeGetRequest('appsilon'));
    expect(res.status).toBe(403);
    expect(mockProviderList).not.toHaveBeenCalled();
  });

  it('[AUTHZ] missing Bearer token gets 401', async () => {
    const res = await GET(makeGetRequest('appsilon', { authHeader: null }));
    expect(res.status).toBe(401);
    expect(mockProviderList).not.toHaveBeenCalled();
  });

  it('[AUTHZ] invalid token gets 401', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'));
    const res = await GET(makeGetRequest('appsilon'));
    expect(res.status).toBe(401);
  });

  it('[AUTHZ] PLATFORM_ADMIN_API_KEY allows server-to-server admin', async () => {
    const previous = process.env.PLATFORM_ADMIN_API_KEY;
    process.env.PLATFORM_ADMIN_API_KEY = 'admin-key-xyz';
    try {
      mockProviderList.mockResolvedValue([]);

      const res = await GET(
        makeGetRequest('appsilon', { authHeader: null, apiKey: 'admin-key-xyz' }),
      );
      expect(res.status).toBe(200);
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
      expect(mockGetMember).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.PLATFORM_ADMIN_API_KEY;
      else process.env.PLATFORM_ADMIN_API_KEY = previous;
    }
  });

  it('[AUTHZ] wrong X-Api-Key falls through to Firebase check', async () => {
    const previous = process.env.PLATFORM_ADMIN_API_KEY;
    process.env.PLATFORM_ADMIN_API_KEY = 'admin-key-xyz';
    try {
      mockProviderList.mockResolvedValue([]);

      const res = await GET(
        makeGetRequest('appsilon', { apiKey: 'wrong-key' }),
      );
      expect(res.status).toBe(200);
      expect(mockGetMember).toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.PLATFORM_ADMIN_API_KEY;
      else process.env.PLATFORM_ADMIN_API_KEY = previous;
    }
  });
});

describe('POST /api/admin/oauth-providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: 'uid-admin' });
    mockNamespaceGet.mockResolvedValue(existingNamespace);
    mockGetMember.mockResolvedValue(adminMember);
  });

  it('[DATA] creates a provider with valid payload', async () => {
    mockProviderCreate.mockResolvedValue(providerConfig);

    const res = await POST(makePostRequest('appsilon', providerInput));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.provider.id).toBe('github');
    expect(mockProviderCreate).toHaveBeenCalledWith('appsilon', providerInput);
  });

  it('[SECURITY] POST response strips clientSecret', async () => {
    mockProviderCreate.mockResolvedValue(providerConfig);

    const res = await POST(makePostRequest('appsilon', providerInput));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.provider).not.toHaveProperty('clientSecret');
    expect(JSON.stringify(json)).not.toContain('client-secret-xyz');
  });

  it('[DATA] accepts optional revokeUrl and iconUrl', async () => {
    const fullInput = {
      ...providerInput,
      revokeUrl: 'https://oauth2.googleapis.com/revoke',
      iconUrl: 'https://example.com/icon.png',
    };
    const fullConfig = {
      ...providerConfig,
      revokeUrl: 'https://oauth2.googleapis.com/revoke',
      iconUrl: 'https://example.com/icon.png',
    };
    mockProviderCreate.mockResolvedValue(fullConfig);

    const res = await POST(makePostRequest('appsilon', fullInput));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.provider.revokeUrl).toBe('https://oauth2.googleapis.com/revoke');
    expect(json.provider.iconUrl).toBe('https://example.com/icon.png');
  });

  it('[ERROR] 400 when namespace missing', async () => {
    const res = await POST(makePostRequest(null, providerInput));
    expect(res.status).toBe(400);
    expect(mockProviderCreate).not.toHaveBeenCalled();
  });

  it('[ERROR] 404 when namespace does not exist', async () => {
    mockNamespaceGet.mockResolvedValue(null);

    const res = await POST(makePostRequest('nope', providerInput));
    expect(res.status).toBe(404);
    expect(mockProviderCreate).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 when body is not JSON', async () => {
    const url = new URL('http://localhost/api/admin/oauth-providers?namespace=appsilon');
    const req = new NextRequest(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: 'not-json',
    });

    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain('JSON');
    expect(mockProviderCreate).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 on schema validation failure (missing clientId)', async () => {
    const invalid = { ...providerInput };
    delete (invalid as Record<string, unknown>).clientId;

    const res = await POST(makePostRequest('appsilon', invalid));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Validation failed');
    expect(mockProviderCreate).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 on invalid URL (authorizeUrl)', async () => {
    const res = await POST(
      makePostRequest('appsilon', { ...providerInput, authorizeUrl: 'not a url' }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Validation failed');
    expect(mockProviderCreate).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 on invalid id pattern (uppercase)', async () => {
    const res = await POST(
      makePostRequest('appsilon', { ...providerInput, id: 'GitHub' }),
    );
    expect(res.status).toBe(400);
    expect(mockProviderCreate).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 when scopes is empty array', async () => {
    const res = await POST(
      makePostRequest('appsilon', { ...providerInput, scopes: [] }),
    );
    expect(res.status).toBe(400);
    expect(mockProviderCreate).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 on unknown field (strict schema)', async () => {
    const res = await POST(
      makePostRequest('appsilon', { ...providerInput, rogueField: 'nope' }),
    );
    expect(res.status).toBe(400);
    expect(mockProviderCreate).not.toHaveBeenCalled();
  });

  it('[ERROR] 409 when a provider with the same id already exists', async () => {
    mockProviderCreate.mockRejectedValue(
      new ProviderAlreadyExistsError('appsilon', 'github'),
    );

    const res = await POST(makePostRequest('appsilon', providerInput));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain('github');
    expect(json.error).toContain('appsilon');
  });

  it('[ISOLATION] create is scoped to requested namespace', async () => {
    mockProviderCreate.mockResolvedValue(providerConfig);

    await POST(makePostRequest('other-ns', providerInput));
    expect(mockProviderCreate).toHaveBeenCalledWith('other-ns', providerInput);
  });

  it('[AUTHZ] plain member gets 403 on POST', async () => {
    mockGetMember.mockResolvedValue(plainMember);

    const res = await POST(makePostRequest('appsilon', providerInput));
    expect(res.status).toBe(403);
    expect(mockProviderCreate).not.toHaveBeenCalled();
  });

  it('[AUTHZ] non-member gets 403 on POST', async () => {
    mockGetMember.mockResolvedValue(null);

    const res = await POST(makePostRequest('appsilon', providerInput));
    expect(res.status).toBe(403);
    expect(mockProviderCreate).not.toHaveBeenCalled();
  });
});
