import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level smoke for the owner/admin half of join links. Handler behaviour
// (personal-workspace refusal, membership ceiling, audit shape) is covered at
// L2 in packages/platform-api/src/handlers/join-links/__tests__/. This file
// proves the adapter wires the dynamic `handle` segment into the schema, that
// 201 carries the once-only token, and that the admin gate reaches the wire.

const mockGetNamespace = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', async () => {
  const { mockPlatformServices } = await import('@/test/platform-services-mock');
  const { InMemoryJoinLinkService } = await import('@mediforce/platform-api/testing');
  const joinLinkService = new InMemoryJoinLinkService();
  return {
    getPlatformServices: () =>
      mockPlatformServices({
        namespaceRepo: {
          getNamespace: mockGetNamespace,
          getMembershipsForUser: vi.fn().mockResolvedValue([]),
        },
        joinLinkService,
        instanceRepo: { getById: vi.fn() },
        auditRepo: { append: mockAuditAppend },
        platformSettingsRepo: { get: vi.fn().mockResolvedValue(null) },
        toolCatalogRepo: {},
        oauthProviderRepo: {},
        agentOAuthTokenRepo: {},
        modelRegistryRepo: {},
        secretsRepo: {},
        namespaceSecretsRepo: {},
        userDirectory: null,
      }),
    getAppBaseUrl: () => 'http://localhost:3000',
  };
});

const mockResolveCallerIdentity = vi.fn();

vi.mock('@/lib/api-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth')>('@/lib/api-auth');
  return {
    ...actual,
    resolveCallerIdentity: (...args: unknown[]) => mockResolveCallerIdentity(...args),
  };
});

import { GET, POST } from '../route';
import { DELETE } from '../[id]/route';

const apiKeyCaller = { kind: 'apiKey' as const, isSystemActor: true as const };

function memberCaller(handle: string, role: 'owner' | 'admin' | 'member') {
  return {
    kind: 'user' as const,
    uid: 'uid-caller',
    namespaces: new Set([handle]),
    namespaceRoles: new Map([[handle, role]]),
    namespaceProcessRoles: new Map(),
    isSystemActor: false as const,
  };
}

const context = { params: Promise.resolve({ handle: 'alpha' }) };

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/namespaces/alpha/join-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/namespaces/[handle]/join-links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockResolvedValue(apiKeyCaller);
    mockGetNamespace.mockResolvedValue({
      handle: 'alpha',
      type: 'organization',
      displayName: 'Alpha Labs',
    });
    mockAuditAppend.mockResolvedValue(undefined);
  });

  it('[HAPPY] POST returns 201 with the plaintext token and a /join URL', async () => {
    const res = await POST(postRequest({ membership: 'member', expiresInDays: 7 }), context);
    const json = (await res.json()) as { token: string; url: string; link: { status: string } };

    expect(res.status).toBe(201);
    expect(json.token.length).toBeGreaterThan(20);
    expect(json.url).toBe(`http://localhost:3000/join/${json.token}`);
    expect(json.link.status).toBe('active');
  });

  it('[HAPPY] GET lists what POST minted, without the token', async () => {
    const created = await POST(postRequest({ membership: 'admin', expiresInDays: 7 }), context);
    const { token } = (await created.json()) as { token: string };

    const res = await GET(
      new NextRequest('http://localhost/api/namespaces/alpha/join-links'),
      context,
    );
    const json = (await res.json()) as { links: Array<{ membership: string }> };

    expect(res.status).toBe(200);
    expect(json.links.some((link) => link.membership === 'admin')).toBe(true);
    expect(JSON.stringify(json)).not.toContain(token);
  });

  it('[HAPPY] DELETE revokes the link the id names', async () => {
    const created = await POST(postRequest({ membership: 'member', expiresInDays: 7 }), context);
    const { link } = (await created.json()) as { link: { id: string } };

    const res = await DELETE(
      new NextRequest(`http://localhost/api/namespaces/alpha/join-links/${link.id}`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ handle: 'alpha', id: link.id }) },
    );
    const json = (await res.json()) as { link: { status: string } };

    expect(res.status).toBe(200);
    expect(json.link.status).toBe('revoked');
  });

  it('[AUTHZ] a plain member gets 403 from every verb', async () => {
    mockResolveCallerIdentity.mockResolvedValue(memberCaller('alpha', 'member'));

    expect(
      (await POST(postRequest({ membership: 'member', expiresInDays: 7 }), context)).status,
    ).toBe(403);
    expect(
      (await GET(new NextRequest('http://localhost/api/namespaces/alpha/join-links'), context))
        .status,
    ).toBe(403);
    expect(
      (
        await DELETE(
          new NextRequest('http://localhost/api/namespaces/alpha/join-links/x', {
            method: 'DELETE',
          }),
          { params: Promise.resolve({ handle: 'alpha', id: 'x' }) },
        )
      ).status,
    ).toBe(403);
  });

  it('[VALIDATION] rejects an expiry outside the contract window', async () => {
    const res = await POST(postRequest({ membership: 'member', expiresInDays: 3650 }), context);
    expect(res.status).toBe(400);
  });

  it('[VALIDATION] refuses to mint one for a personal workspace', async () => {
    mockGetNamespace.mockResolvedValue({
      handle: 'alpha',
      type: 'personal',
      displayName: 'Ada',
    });

    const res = await POST(postRequest({ membership: 'member', expiresInDays: 7 }), context);
    expect(res.status).toBe(409);
  });
});
