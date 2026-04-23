import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { AgentOAuthToken } from '@mediforce/platform-core';

// ---- Mocks ----

const mockVerifyIdToken = vi.fn();
const mockTokenListByAgent = vi.fn();

vi.mock('@mediforce/platform-infra', () => ({
  getAdminAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    agentOAuthTokenRepo: { listByAgent: mockTokenListByAgent },
  }),
}));

import { GET } from '../route';

// ---- Helpers ----

function makeGetRequest(
  agentId: string,
  namespace: string | null,
  authHeader: string | null = 'Bearer valid-token',
): NextRequest {
  const url = new URL(`http://localhost/api/agents/${agentId}/oauth`);
  if (namespace !== null) url.searchParams.set('namespace', namespace);
  const headers: Record<string, string> = {};
  if (authHeader !== null) headers.Authorization = authHeader;
  return new NextRequest(url.toString(), { method: 'GET', headers });
}

const makeParams = (id: string) => Promise.resolve({ id });

function buildToken(
  overrides: Partial<AgentOAuthToken & { serverName: string }> = {},
): AgentOAuthToken & { serverName: string } {
  return {
    serverName: 'gh',
    provider: 'github',
    accessToken: 'access-token-xyz',
    refreshToken: 'refresh-token-xyz',
    expiresAt: 1_800_000_000_000,
    scope: 'repo read:user',
    providerUserId: '12345',
    accountLogin: '@testuser',
    connectedAt: 1_700_000_000_000,
    connectedBy: 'uid-1',
    ...overrides,
  };
}

// ---- Tests ----

describe('GET /api/agents/:id/oauth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: 'uid-1' });
  });

  it('[DATA] returns tokens with public fields only (no access/refresh tokens)', async () => {
    mockTokenListByAgent.mockResolvedValue([buildToken()]);

    const res = await GET(
      makeGetRequest('agent-1', 'appsilon'),
      { params: makeParams('agent-1') },
    );
    const json = (await res.json()) as { tokens: Array<Record<string, unknown>> };

    expect(res.status).toBe(200);
    expect(json.tokens).toHaveLength(1);
    const entry = json.tokens[0];
    expect(entry.serverName).toBe('gh');
    expect(entry.provider).toBe('github');
    expect(entry.accountLogin).toBe('@testuser');
    expect(entry.providerUserId).toBe('12345');
    expect(entry.scope).toBe('repo read:user');
    expect(entry.expiresAt).toBe(1_800_000_000_000);
    expect(entry.connectedAt).toBe(1_700_000_000_000);
    expect(entry.connectedBy).toBe('uid-1');
    expect(entry).not.toHaveProperty('accessToken');
    expect(entry).not.toHaveProperty('refreshToken');
  });

  it('[DATA] returns multiple tokens for different servers', async () => {
    mockTokenListByAgent.mockResolvedValue([
      buildToken({ serverName: 'gh-one', accountLogin: '@one' }),
      buildToken({ serverName: 'gh-two', accountLogin: '@two' }),
    ]);

    const res = await GET(
      makeGetRequest('agent-1', 'appsilon'),
      { params: makeParams('agent-1') },
    );
    const json = (await res.json()) as { tokens: Array<Record<string, unknown>> };

    expect(res.status).toBe(200);
    expect(json.tokens).toHaveLength(2);
    expect(json.tokens.map((t) => t.serverName).sort()).toEqual(['gh-one', 'gh-two']);
  });

  it('[DATA] returns empty array when no tokens exist', async () => {
    mockTokenListByAgent.mockResolvedValue([]);

    const res = await GET(
      makeGetRequest('agent-1', 'appsilon'),
      { params: makeParams('agent-1') },
    );
    const json = (await res.json()) as { tokens: unknown[] };

    expect(res.status).toBe(200);
    expect(json.tokens).toEqual([]);
  });

  it('[ERROR] 401 when auth header missing', async () => {
    const res = await GET(
      makeGetRequest('agent-1', 'appsilon', null),
      { params: makeParams('agent-1') },
    );
    expect(res.status).toBe(401);
    expect(mockTokenListByAgent).not.toHaveBeenCalled();
  });

  it('[ERROR] 401 when token verification fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'));

    const res = await GET(
      makeGetRequest('agent-1', 'appsilon'),
      { params: makeParams('agent-1') },
    );
    expect(res.status).toBe(401);
  });

  it('[ERROR] 400 when namespace missing', async () => {
    const res = await GET(
      makeGetRequest('agent-1', null),
      { params: makeParams('agent-1') },
    );
    expect(res.status).toBe(400);
    expect(mockTokenListByAgent).not.toHaveBeenCalled();
  });

  it('[ISOLATION] queries scoped to the requested namespace + agent', async () => {
    mockTokenListByAgent.mockResolvedValue([]);

    await GET(
      makeGetRequest('other-agent', 'other-ns'),
      { params: makeParams('other-agent') },
    );

    expect(mockTokenListByAgent).toHaveBeenCalledWith('other-ns', 'other-agent');
  });
});
