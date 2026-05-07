import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { verifyState } from '@mediforce/agent-runtime';
import { InMemoryConnectionRepository, InMemoryOAuthProviderRepository } from '@mediforce/platform-core';

const mockVerifyIdToken = vi.fn();
const mockNamespaceGet = vi.fn();
const mockGetMember = vi.fn();
const connectionRepo = new InMemoryConnectionRepository();
const providerRepo = new InMemoryOAuthProviderRepository();

vi.mock('@mediforce/platform-infra', () => ({
  getAdminAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    namespaceRepo: { getNamespace: mockNamespaceGet, getMember: mockGetMember },
    connectionRepo,
    oauthProviderRepo: providerRepo,
  }),
}));

const PLATFORM_SECRET = 'unit-test-platform-secret';
const ORIGINAL_KEY = process.env.PLATFORM_API_KEY;

import { POST } from '../route';

const NS = 'acme';
const namespaceDoc = { handle: NS, type: 'organization', displayName: 'Acme', createdAt: '2026-01-01T00:00:00.000Z' };
const adminMember = { uid: 'uid-admin', role: 'admin' as const, joinedAt: '2026-01-01T00:00:00.000Z' };

function url(connectionId: string, ns: string | null = NS): URL {
  const u = new URL(`http://localhost/api/admin/connections/${connectionId}/oauth/start`);
  if (ns !== null) u.searchParams.set('namespace', ns);
  return u;
}

function postReq(connectionId: string, ns: string | null = NS, auth: string | null = 'Bearer valid-token'): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth !== null) headers.Authorization = auth;
  return new NextRequest(url(connectionId, ns).toString(), { method: 'POST', headers });
}

const params = (id: string) => Promise.resolve({ id });

beforeEach(async () => {
  vi.clearAllMocks();
  connectionRepo.clear();
  process.env.PLATFORM_API_KEY = PLATFORM_SECRET;
  mockVerifyIdToken.mockResolvedValue({ uid: 'uid-admin' });
  mockNamespaceGet.mockResolvedValue(namespaceDoc);
  mockGetMember.mockResolvedValue(adminMember);

  // Reset provider repo by deleting any leftover providers (clear() not exposed).
  for (const p of await providerRepo.list(NS)) {
    await providerRepo.delete(NS, p.id);
  }
  await providerRepo.create(NS, {
    id: 'github',
    name: 'GitHub',
    clientId: 'cid',
    clientSecret: 'csec',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['repo', 'read:user'],
  });
});

describe('POST /api/admin/connections/[id]/oauth/start', () => {
  it('[DATA] returns authorize URL + state for an oauth connection', async () => {
    await connectionRepo.create(NS, {
      id: 'github-mediforce',
      name: 'GitHub',
      auth: { type: 'oauth', providerId: 'github' },
    });

    const res = await POST(postReq('github-mediforce'), { params: params('github-mediforce') });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authorizeUrl).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    expect(body.authorizeUrl).toContain('client_id=cid');
    expect(body.authorizeUrl).toContain('scope=repo+read%3Auser');
    expect(body.authorizeUrl).toContain('code_challenge=');
    expect(body.authorizeUrl).toContain('code_challenge_method=S256');
    expect(body.state).toMatch(/\..+/);

    // State is a verifiable signed token containing connectionId + providerId.
    const verified = await verifyState(body.state, PLATFORM_SECRET, 60_000);
    expect(verified).not.toBeNull();
    expect(verified?.connectionId).toBe('github-mediforce');
    expect(verified?.providerId).toBe('github');
    expect(verified?.namespace).toBe(NS);
    expect(verified?.codeVerifier).toBeTypeOf('string');
  });

  it('[ERROR] 404 when connection does not exist', async () => {
    const res = await POST(postReq('nope'), { params: params('nope') });
    expect(res.status).toBe(404);
  });

  it('[ERROR] 400 when connection is headers-typed (not oauth)', async () => {
    await connectionRepo.create(NS, {
      id: 'static',
      name: 'Static',
      auth: { type: 'headers', headers: { 'X-Api-Key': '{{SECRET:k}}' } },
    });
    const res = await POST(postReq('static'), { params: params('static') });
    expect(res.status).toBe(400);
  });

  it('[ERROR] 404 when referenced OAuth provider is missing from namespace', async () => {
    await connectionRepo.create(NS, {
      id: 'orphan',
      name: 'Orphan',
      auth: { type: 'oauth', providerId: 'google' }, // never seeded
    });
    const res = await POST(postReq('orphan'), { params: params('orphan') });
    expect(res.status).toBe(404);
  });

  it('[AUTHZ] 403 for plain member', async () => {
    await connectionRepo.create(NS, {
      id: 'github-mediforce',
      name: 'GitHub',
      auth: { type: 'oauth', providerId: 'github' },
    });
    mockGetMember.mockResolvedValue({ uid: 'uid-admin', role: 'member', joinedAt: '2026-01-01T00:00:00.000Z' });
    const res = await POST(postReq('github-mediforce'), { params: params('github-mediforce') });
    expect(res.status).toBe(403);
  });
});
