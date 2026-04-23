import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ProviderAlreadyExistsError } from '@mediforce/platform-core';

// ---- Mocks ----

const mockNamespaceGet = vi.fn();
const mockProviderList = vi.fn();
const mockProviderCreate = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    namespaceRepo: { getNamespace: mockNamespaceGet },
    oauthProviderRepo: {
      list: mockProviderList,
      create: mockProviderCreate,
    },
  }),
}));

import { GET, POST } from '../route';

// ---- Helpers ----

function makeGetRequest(namespace?: string): NextRequest {
  const url = new URL('http://localhost/api/admin/oauth-providers');
  if (namespace !== undefined) url.searchParams.set('namespace', namespace);
  return new NextRequest(url.toString());
}

function makePostRequest(namespace: string | null, body: unknown): NextRequest {
  const url = new URL('http://localhost/api/admin/oauth-providers');
  if (namespace !== null) url.searchParams.set('namespace', namespace);
  return new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const existingNamespace = {
  handle: 'appsilon',
  type: 'organization',
  displayName: 'Appsilon',
  createdAt: '2026-01-01T00:00:00.000Z',
};

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
  beforeEach(() => vi.clearAllMocks());

  it('[DATA] lists providers in a namespace', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);
    mockProviderList.mockResolvedValue([providerConfig]);

    const res = await GET(makeGetRequest('appsilon'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.providers).toEqual([providerConfig]);
    expect(mockProviderList).toHaveBeenCalledWith('appsilon');
  });

  it('[DATA] returns empty list when no providers exist', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);
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
    mockNamespaceGet.mockResolvedValue(existingNamespace);
    mockProviderList.mockResolvedValue([providerConfig]);

    await GET(makeGetRequest('other-ns'));
    expect(mockProviderList).toHaveBeenCalledWith('other-ns');
    expect(mockProviderList).not.toHaveBeenCalledWith('appsilon');
  });
});

describe('POST /api/admin/oauth-providers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('[DATA] creates a provider with valid payload', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);
    mockProviderCreate.mockResolvedValue(providerConfig);

    const res = await POST(makePostRequest('appsilon', providerInput));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.provider).toEqual(providerConfig);
    expect(mockProviderCreate).toHaveBeenCalledWith('appsilon', providerInput);
  });

  it('[DATA] accepts optional revokeUrl and iconUrl', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);
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
    mockNamespaceGet.mockResolvedValue(existingNamespace);

    const url = new URL('http://localhost/api/admin/oauth-providers?namespace=appsilon');
    const req = new NextRequest(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });

    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain('JSON');
    expect(mockProviderCreate).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 on schema validation failure (missing clientId)', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);

    const invalid = { ...providerInput };
    delete (invalid as Record<string, unknown>).clientId;

    const res = await POST(makePostRequest('appsilon', invalid));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Validation failed');
    expect(mockProviderCreate).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 on invalid URL (authorizeUrl)', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);

    const res = await POST(
      makePostRequest('appsilon', { ...providerInput, authorizeUrl: 'not a url' }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Validation failed');
    expect(mockProviderCreate).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 on invalid id pattern (uppercase)', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);

    const res = await POST(
      makePostRequest('appsilon', { ...providerInput, id: 'GitHub' }),
    );
    expect(res.status).toBe(400);
    expect(mockProviderCreate).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 when scopes is empty array', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);

    const res = await POST(
      makePostRequest('appsilon', { ...providerInput, scopes: [] }),
    );
    expect(res.status).toBe(400);
    expect(mockProviderCreate).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 on unknown field (strict schema)', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);

    const res = await POST(
      makePostRequest('appsilon', { ...providerInput, rogueField: 'nope' }),
    );
    expect(res.status).toBe(400);
    expect(mockProviderCreate).not.toHaveBeenCalled();
  });

  it('[ERROR] 409 when a provider with the same id already exists', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);
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
    mockNamespaceGet.mockResolvedValue(existingNamespace);
    mockProviderCreate.mockResolvedValue(providerConfig);

    await POST(makePostRequest('other-ns', providerInput));
    expect(mockProviderCreate).toHaveBeenCalledWith('other-ns', providerInput);
  });
});
