import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level smoke. Handler behaviour (anti-enum gate, directory degradation)
// is covered at L2 in packages/platform-api/src/handlers/users/__tests__/.
// This file proves the adapter wires schema + services + handler, and that
// the new query-param contract (?namespace=) is honored.

const mockGetMembers = vi.fn();
const mockGetUserMetadata = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    namespaceRepo: { getMembers: mockGetMembers },
    userDirectory: { getUserMetadata: mockGetUserMetadata },
    instanceRepo: { getById: vi.fn() },
    auditRepo: { append: vi.fn() },
    toolCatalogRepo: {},
    oauthProviderRepo: {},
    agentOAuthTokenRepo: {},
    modelRegistryRepo: {},
    secretsRepo: {},
    namespaceSecretsRepo: {},
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

import { GET } from '../route';

function memberCaller(handle = 'alpha') {
  return {
    kind: 'user' as const,
    uid: 'uid-member',
    namespaces: new Set([handle]),
    namespaceRoles: new Map([[handle, 'member' as const]]),
    isSystemActor: false as const,
  };
}

const apiKeyCaller = { kind: 'apiKey' as const, isSystemActor: true as const };

function makeGetRequest(query: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost/api/users/members');
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url.toString());
}

const sampleMember = {
  uid: 'uid-member',
  role: 'member',
  joinedAt: '2026-02-01T00:00:00.000Z',
};

describe('GET /api/users/members', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockResolvedValue(apiKeyCaller);
    mockGetMembers.mockResolvedValue([sampleMember]);
    mockGetUserMetadata.mockResolvedValue({
      email: 'member@alpha.test',
      lastSignInTime: '2026-05-01T00:00:00.000Z',
    });
  });

  it('[DATA] returns members with auth metadata for apiKey caller', async () => {
    const res = await GET(makeGetRequest({ namespace: 'alpha' }));
    const json = (await res.json()) as { members: Array<{ uid: string; email: string | null }> };

    expect(res.status).toBe(200);
    expect(json.members).toHaveLength(1);
    expect(json.members[0]).toMatchObject({
      uid: 'uid-member',
      email: 'member@alpha.test',
      lastSignInTime: '2026-05-01T00:00:00.000Z',
    });
    expect(mockGetMembers).toHaveBeenCalledWith('alpha');
  });

  it('[AUTHZ] member caller gets 200 with the list', async () => {
    mockResolveCallerIdentity.mockResolvedValue(memberCaller('alpha'));

    const res = await GET(makeGetRequest({ namespace: 'alpha' }));

    expect(res.status).toBe(200);
  });

  it('[AUTHZ] non-member gets 404 (anti-enum bug fix)', async () => {
    mockResolveCallerIdentity.mockResolvedValue(memberCaller('beta'));

    const res = await GET(makeGetRequest({ namespace: 'alpha' }));

    expect(res.status).toBe(404);
    expect(mockGetMembers).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 when namespace query param missing', async () => {
    const res = await GET(makeGetRequest());

    expect(res.status).toBe(400);
    expect(mockGetMembers).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 when only the legacy ?handle= param is sent', async () => {
    const res = await GET(makeGetRequest({ handle: 'alpha' }));

    expect(res.status).toBe(400);
    expect(mockGetMembers).not.toHaveBeenCalled();
  });
});
