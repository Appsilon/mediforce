import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ProviderAlreadyExistsError } from '@mediforce/platform-core';

// Route-level smoke. Handler behavior (role gate, audit, conflict mapping,
// public-secret strip) is covered exhaustively at L2 in
// packages/platform-api/src/handlers/oauth-providers/__tests__/. The adapter
// pipeline (HandlerError → HTTP status) is covered by route-adapter tests.
// What remains here: prove the Next.js route file wires the schema, services,
// and handler together, plus a couple of cross-cutting auth scenarios.

const mockProviderList = vi.fn();
const mockProviderCreate = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    oauthProviderRepo: {
      list: mockProviderList,
      get: vi.fn(),
      create: mockProviderCreate,
      update: vi.fn(),
      delete: vi.fn(),
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

import { GET, POST } from '../route';

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

const apiKeyCaller = { kind: 'apiKey' as const, isSystemActor: true as const };

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

describe('GET /api/admin/oauth-providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockResolvedValue(adminCaller());
    mockAuditAppend.mockResolvedValue(undefined);
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

  it('[SECURITY] response strips clientSecret', async () => {
    mockProviderList.mockResolvedValue([providerConfig]);

    const res = await GET(makeGetRequest('appsilon'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.providers[0]).not.toHaveProperty('clientSecret');
    expect(JSON.stringify(json)).not.toContain('client-secret-xyz');
  });

  it('[ERROR] 400 when namespace missing', async () => {
    const res = await GET(makeGetRequest());

    expect(res.status).toBe(400);
    expect(mockProviderList).not.toHaveBeenCalled();
  });

  it('[AUTHZ] api-key caller passes', async () => {
    mockResolveCallerIdentity.mockResolvedValue(apiKeyCaller);
    mockProviderList.mockResolvedValue([]);

    const res = await GET(makeGetRequest('appsilon'));
    expect(res.status).toBe(200);
  });

  it('[AUTHZ] plain member gets 403', async () => {
    mockResolveCallerIdentity.mockResolvedValue(memberCaller());

    const res = await GET(makeGetRequest('appsilon'));

    expect(res.status).toBe(403);
    expect(mockProviderList).not.toHaveBeenCalled();
  });

  it('[AUTHZ] non-member (no role on namespace) gets 403', async () => {
    mockResolveCallerIdentity.mockResolvedValue(adminCaller('other-ns'));

    const res = await GET(makeGetRequest('appsilon'));

    expect(res.status).toBe(403);
    expect(mockProviderList).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/oauth-providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockResolvedValue(adminCaller());
    mockAuditAppend.mockResolvedValue(undefined);
  });

  it('[DATA] creates a provider with valid payload', async () => {
    mockProviderCreate.mockResolvedValue(providerConfig);

    const res = await POST(makePostRequest('appsilon', providerInput));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.provider.id).toBe('github');
    expect(mockProviderCreate).toHaveBeenCalledWith('appsilon', providerInput);
  });

  it('[SECURITY] POST response strips clientSecret', async () => {
    mockProviderCreate.mockResolvedValue(providerConfig);

    const res = await POST(makePostRequest('appsilon', providerInput));
    const json = await res.json();

    expect(json.provider).not.toHaveProperty('clientSecret');
    expect(JSON.stringify(json)).not.toContain('client-secret-xyz');
  });

  it('[ERROR] 400 on schema validation failure (missing clientId)', async () => {
    const invalid = { ...providerInput };
    delete (invalid as Record<string, unknown>).clientId;

    const res = await POST(makePostRequest('appsilon', invalid));

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

  it('[ERROR] 409 when provider already exists', async () => {
    mockProviderCreate.mockRejectedValue(
      new ProviderAlreadyExistsError('appsilon', 'github'),
    );

    const res = await POST(makePostRequest('appsilon', providerInput));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(JSON.stringify(json)).toContain('github');
  });

  it('[AUTHZ] plain member gets 403 on POST', async () => {
    mockResolveCallerIdentity.mockResolvedValue(memberCaller());

    const res = await POST(makePostRequest('appsilon', providerInput));

    expect(res.status).toBe(403);
    expect(mockProviderCreate).not.toHaveBeenCalled();
  });
});
