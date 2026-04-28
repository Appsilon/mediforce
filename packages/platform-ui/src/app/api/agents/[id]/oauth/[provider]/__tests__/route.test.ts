import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { AgentOAuthToken, OAuthProviderConfig } from '@mediforce/platform-core';

// ---- Mocks ----

const mockVerifyIdToken = vi.fn();
const mockTokenGet = vi.fn();
const mockTokenDelete = vi.fn();
const mockProviderGet = vi.fn();
const mockGetMember = vi.fn();

vi.mock('@mediforce/platform-infra', () => ({
  getAdminAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    agentOAuthTokenRepo: {
      get: mockTokenGet,
      delete: mockTokenDelete,
    },
    oauthProviderRepo: { get: mockProviderGet },
    namespaceRepo: { getMember: mockGetMember },
  }),
}));

const memberAppsilon = {
  uid: 'uid-1',
  role: 'member' as const,
  joinedAt: '2026-01-01T00:00:00.000Z',
};

import { DELETE } from '../route';

// ---- Helpers ----

function makeDeleteRequest(options: {
  agentId: string;
  providerSlug: string;
  namespace: string | null;
  serverName: string | null;
  revokeAtProvider?: boolean;
  authHeader?: string | null;
}): NextRequest {
  const url = new URL(
    `http://localhost/api/agents/${options.agentId}/oauth/${options.providerSlug}`,
  );
  if (options.namespace !== null) url.searchParams.set('namespace', options.namespace);
  if (options.serverName !== null) url.searchParams.set('serverName', options.serverName);
  if (options.revokeAtProvider === true) url.searchParams.set('revokeAtProvider', 'true');
  const headers: Record<string, string> = {};
  const authHeader = options.authHeader === undefined ? 'Bearer valid-token' : options.authHeader;
  if (authHeader !== null) headers.Authorization = authHeader;
  return new NextRequest(url.toString(), {
    method: 'DELETE',
    headers,
  });
}

const makeParams = (id: string, provider: string) => Promise.resolve({ id, provider });

const tokenDoc: AgentOAuthToken = {
  provider: 'github',
  accessToken: 'access-token-xyz',
  refreshToken: 'refresh-token-xyz',
  expiresAt: Date.now() + 3600_000,
  scope: 'repo read:user',
  providerUserId: '12345',
  accountLogin: 'testuser',
  connectedAt: Date.now(),
  connectedBy: 'uid-1',
};

const providerConfigWithRevoke: OAuthProviderConfig = {
  id: 'github',
  name: 'GitHub',
  clientId: 'cid',
  clientSecret: 'csecret',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  revokeUrl: 'https://api.github.com/applications/cid/token',
  userInfoUrl: 'https://api.github.com/user',
  scopes: ['repo'],
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
};

const providerConfigNoRevoke: OAuthProviderConfig = {
  ...providerConfigWithRevoke,
  revokeUrl: undefined,
};

// ---- Tests ----

describe('DELETE /api/agents/:id/oauth/:provider', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: 'uid-1' });
    mockGetMember.mockResolvedValue(memberAppsilon);
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('[DATA] revokeAtProvider=false: deletes token without calling provider revoke', async () => {
    mockTokenDelete.mockResolvedValue(true);

    const res = await DELETE(
      makeDeleteRequest({
        agentId: 'agent-1',
        providerSlug: 'github',
        namespace: 'appsilon',
        serverName: 'gh',
      }),
      { params: makeParams('agent-1', 'github') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockTokenDelete).toHaveBeenCalledWith('appsilon', 'agent-1', 'gh');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockProviderGet).not.toHaveBeenCalled();
  });

  it('[DATA] revokeAtProvider=true: calls provider revoke then deletes local token', async () => {
    mockTokenGet.mockResolvedValue(tokenDoc);
    mockProviderGet.mockResolvedValue(providerConfigWithRevoke);
    mockTokenDelete.mockResolvedValue(true);
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const res = await DELETE(
      makeDeleteRequest({
        agentId: 'agent-1',
        providerSlug: 'github',
        namespace: 'appsilon',
        serverName: 'gh',
        revokeAtProvider: true,
      }),
      { params: makeParams('agent-1', 'github') },
    );
    expect(res.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [revokeUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(revokeUrl).toBe('https://api.github.com/applications/cid/token');
    expect(init.method).toBe('POST');
    const body = (init.body as string) ?? '';
    expect(body).toContain('token=access-token-xyz');

    expect(mockTokenDelete).toHaveBeenCalledWith('appsilon', 'agent-1', 'gh');
  });

  it('[DATA] revokeAtProvider=true with no revokeUrl: skips fetch, still deletes', async () => {
    mockTokenGet.mockResolvedValue(tokenDoc);
    mockProviderGet.mockResolvedValue(providerConfigNoRevoke);
    mockTokenDelete.mockResolvedValue(true);

    const res = await DELETE(
      makeDeleteRequest({
        agentId: 'agent-1',
        providerSlug: 'github',
        namespace: 'appsilon',
        serverName: 'gh',
        revokeAtProvider: true,
      }),
      { params: makeParams('agent-1', 'github') },
    );

    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockTokenDelete).toHaveBeenCalled();
  });

  it('[DATA] revokeAtProvider=true with no stored token: does not fetch, still calls delete', async () => {
    mockTokenGet.mockResolvedValue(null);
    mockProviderGet.mockResolvedValue(providerConfigWithRevoke);
    mockTokenDelete.mockResolvedValue(false);

    const res = await DELETE(
      makeDeleteRequest({
        agentId: 'agent-1',
        providerSlug: 'github',
        namespace: 'appsilon',
        serverName: 'gh',
        revokeAtProvider: true,
      }),
      { params: makeParams('agent-1', 'github') },
    );
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockTokenDelete).toHaveBeenCalledWith('appsilon', 'agent-1', 'gh');
  });

  it('[DATA] provider fetch throws: failure is swallowed, local delete still runs', async () => {
    mockTokenGet.mockResolvedValue(tokenDoc);
    mockProviderGet.mockResolvedValue(providerConfigWithRevoke);
    mockTokenDelete.mockResolvedValue(true);
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await DELETE(
      makeDeleteRequest({
        agentId: 'agent-1',
        providerSlug: 'github',
        namespace: 'appsilon',
        serverName: 'gh',
        revokeAtProvider: true,
      }),
      { params: makeParams('agent-1', 'github') },
    );
    expect(res.status).toBe(200);
    expect(mockTokenDelete).toHaveBeenCalledWith('appsilon', 'agent-1', 'gh');
  });

  it('[DATA] provider returns 500: local delete still runs, 200 returned', async () => {
    mockTokenGet.mockResolvedValue(tokenDoc);
    mockProviderGet.mockResolvedValue(providerConfigWithRevoke);
    mockTokenDelete.mockResolvedValue(true);
    fetchMock.mockResolvedValue(new Response('server error', { status: 500 }));

    const res = await DELETE(
      makeDeleteRequest({
        agentId: 'agent-1',
        providerSlug: 'github',
        namespace: 'appsilon',
        serverName: 'gh',
        revokeAtProvider: true,
      }),
      { params: makeParams('agent-1', 'github') },
    );
    expect(res.status).toBe(200);
    expect(mockTokenDelete).toHaveBeenCalledWith('appsilon', 'agent-1', 'gh');
  });

  it('[ERROR] 401 when auth header missing', async () => {
    const res = await DELETE(
      makeDeleteRequest({
        agentId: 'agent-1',
        providerSlug: 'github',
        namespace: 'appsilon',
        serverName: 'gh',
        authHeader: null,
      }),
      { params: makeParams('agent-1', 'github') },
    );
    expect(res.status).toBe(401);
    expect(mockTokenDelete).not.toHaveBeenCalled();
  });

  it('[ERROR] 401 when token verification fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'));

    const res = await DELETE(
      makeDeleteRequest({
        agentId: 'agent-1',
        providerSlug: 'github',
        namespace: 'appsilon',
        serverName: 'gh',
      }),
      { params: makeParams('agent-1', 'github') },
    );
    expect(res.status).toBe(401);
  });

  it('[ERROR] 400 when namespace missing', async () => {
    const res = await DELETE(
      makeDeleteRequest({
        agentId: 'agent-1',
        providerSlug: 'github',
        namespace: null,
        serverName: 'gh',
      }),
      { params: makeParams('agent-1', 'github') },
    );
    expect(res.status).toBe(400);
    expect(mockTokenDelete).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 when serverName missing', async () => {
    const res = await DELETE(
      makeDeleteRequest({
        agentId: 'agent-1',
        providerSlug: 'github',
        namespace: 'appsilon',
        serverName: null,
      }),
      { params: makeParams('agent-1', 'github') },
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain('serverName');
    expect(mockTokenDelete).not.toHaveBeenCalled();
  });

  it('[AUTHZ] caller who is not a member of the namespace gets 404 and does not delete', async () => {
    mockGetMember.mockResolvedValue(null);

    const res = await DELETE(
      makeDeleteRequest({
        agentId: 'agent-1',
        providerSlug: 'github',
        namespace: 'other-ns',
        serverName: 'gh',
      }),
      { params: makeParams('agent-1', 'github') },
    );
    expect(res.status).toBe(404);
    expect(mockTokenDelete).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('[AUTHZ] membership check uses the query-param namespace', async () => {
    mockTokenDelete.mockResolvedValue(true);

    await DELETE(
      makeDeleteRequest({
        agentId: 'agent-1',
        providerSlug: 'github',
        namespace: 'other-ns',
        serverName: 'gh',
      }),
      { params: makeParams('agent-1', 'github') },
    );
    expect(mockGetMember).toHaveBeenCalledWith('other-ns', 'uid-1');
  });
});
