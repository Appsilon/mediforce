import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { verifyState } from '@mediforce/agent-runtime';
import type { AgentDefinition, OAuthProviderConfig } from '@mediforce/platform-core';

// ---- Mocks ----

const mockVerifyIdToken = vi.fn();
const mockAgentGetById = vi.fn();
const mockProviderGet = vi.fn();
const mockGetMember = vi.fn();

vi.mock('@mediforce/platform-infra', () => ({
  getAdminAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    agentDefinitionRepo: { getById: mockAgentGetById },
    oauthProviderRepo: { get: mockProviderGet },
    namespaceRepo: { getMember: mockGetMember },
  }),
}));

const memberAppsilon = {
  uid: 'user-firebase-uid',
  role: 'member' as const,
  joinedAt: '2026-01-01T00:00:00.000Z',
};

import { POST } from '../route';

// ---- Helpers ----

function makePostRequest(
  agentId: string,
  providerSlug: string,
  namespace: string | null,
  body: unknown,
  authHeader: string | null = 'Bearer valid-token',
): NextRequest {
  const url = new URL(
    `http://localhost/api/agents/${agentId}/oauth/${providerSlug}/start`,
  );
  if (namespace !== null) url.searchParams.set('namespace', namespace);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader !== null) headers.Authorization = authHeader;
  return new NextRequest(url.toString(), {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const makeParams = (id: string, provider: string) => Promise.resolve({ id, provider });

const providerConfig: OAuthProviderConfig = {
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

function makeAgentWithOAuthBinding(
  overrides: { serverName?: string; provider?: string } = {},
): AgentDefinition {
  const serverName = overrides.serverName ?? 'gh';
  const provider = overrides.provider ?? 'github';
  return {
    id: 'agent-1',
    kind: 'plugin',
    runtimeId: 'claude-code-agent',
    name: 'Agent One',
    iconName: 'Bot',
    description: '',
    foundationModel: 'anthropic/claude-sonnet-4',
    systemPrompt: '',
    inputDescription: '',
    outputDescription: '',
    skillFileNames: [],
    mcpServers: {
      [serverName]: {
        type: 'http',
        url: 'https://api.example.com/mcp',
        auth: {
          type: 'oauth',
          provider,
          headerName: 'Authorization',
          headerValueTemplate: 'Bearer {token}',
        },
      },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

// ---- Tests ----

describe('POST /api/agents/:id/oauth/:provider/start', () => {
  const originalKey = process.env.PLATFORM_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-firebase-uid' });
    mockGetMember.mockResolvedValue(memberAppsilon);
    process.env.PLATFORM_API_KEY = 'test-platform-secret';
  });

  afterEach(() => {
    process.env.PLATFORM_API_KEY = originalKey;
  });

  it('[DATA] returns authorizeUrl and signed state for a properly configured binding', async () => {
    mockAgentGetById.mockResolvedValue(makeAgentWithOAuthBinding());
    mockProviderGet.mockResolvedValue(providerConfig);

    const res = await POST(
      makePostRequest('agent-1', 'github', 'appsilon', { serverName: 'gh' }),
      { params: makeParams('agent-1', 'github') },
    );
    const json = (await res.json()) as { authorizeUrl: string; state: string };

    expect(res.status).toBe(200);
    expect(typeof json.authorizeUrl).toBe('string');
    expect(typeof json.state).toBe('string');

    const url = new URL(json.authorizeUrl);
    expect(url.origin).toBe('https://github.com');
    expect(url.pathname).toBe('/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id-xyz');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('repo read:user');
    expect(url.searchParams.get('state')).toBe(json.state);
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost/api/oauth/github/callback',
    );
  });

  it('[DATA] state verifies and carries namespace, agentId, serverName, providerId, connectedBy', async () => {
    mockAgentGetById.mockResolvedValue(makeAgentWithOAuthBinding());
    mockProviderGet.mockResolvedValue(providerConfig);

    const res = await POST(
      makePostRequest('agent-1', 'github', 'appsilon', { serverName: 'gh' }),
      { params: makeParams('agent-1', 'github') },
    );
    const json = (await res.json()) as { state: string };

    const payload = await verifyState(json.state, 'test-platform-secret', 60_000);
    expect(payload).not.toBeNull();
    expect(payload?.namespace).toBe('appsilon');
    expect(payload?.agentId).toBe('agent-1');
    expect(payload?.serverName).toBe('gh');
    expect(payload?.providerId).toBe('github');
    expect(payload?.connectedBy).toBe('user-firebase-uid');
  });

  it('[ERROR] 401 when auth header missing', async () => {
    const res = await POST(
      makePostRequest('agent-1', 'github', 'appsilon', { serverName: 'gh' }, null),
      { params: makeParams('agent-1', 'github') },
    );
    expect(res.status).toBe(401);
    expect(mockAgentGetById).not.toHaveBeenCalled();
  });

  it('[ERROR] 401 when token verification fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'));
    const res = await POST(
      makePostRequest('agent-1', 'github', 'appsilon', { serverName: 'gh' }),
      { params: makeParams('agent-1', 'github') },
    );
    expect(res.status).toBe(401);
  });

  it('[ERROR] 400 when namespace query missing', async () => {
    const res = await POST(
      makePostRequest('agent-1', 'github', null, { serverName: 'gh' }),
      { params: makeParams('agent-1', 'github') },
    );
    expect(res.status).toBe(400);
    expect(mockAgentGetById).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 when serverName missing from body', async () => {
    const res = await POST(
      makePostRequest('agent-1', 'github', 'appsilon', {}),
      { params: makeParams('agent-1', 'github') },
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe('Validation failed');
    expect(mockAgentGetById).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 when body is missing or not JSON', async () => {
    const url = new URL(
      'http://localhost/api/agents/agent-1/oauth/github/start?namespace=appsilon',
    );
    const req = new NextRequest(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
      body: 'not-json',
    });

    const res = await POST(req, { params: makeParams('agent-1', 'github') });
    expect(res.status).toBe(400);
  });

  it('[ERROR] 404 when agent not found', async () => {
    mockAgentGetById.mockResolvedValue(null);

    const res = await POST(
      makePostRequest('missing', 'github', 'appsilon', { serverName: 'gh' }),
      { params: makeParams('missing', 'github') },
    );
    expect(res.status).toBe(404);
    expect(mockProviderGet).not.toHaveBeenCalled();
  });

  it('[ERROR] 404 when binding with given serverName does not exist', async () => {
    mockAgentGetById.mockResolvedValue(makeAgentWithOAuthBinding({ serverName: 'gh' }));

    const res = await POST(
      makePostRequest('agent-1', 'github', 'appsilon', { serverName: 'other' }),
      { params: makeParams('agent-1', 'github') },
    );
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.error).toContain('other');
  });

  it('[ERROR] 400 when binding is not http/oauth', async () => {
    mockAgentGetById.mockResolvedValue({
      ...makeAgentWithOAuthBinding(),
      mcpServers: {
        gh: { type: 'stdio', catalogId: 'some-tool' },
      },
    });

    const res = await POST(
      makePostRequest('agent-1', 'github', 'appsilon', { serverName: 'gh' }),
      { params: makeParams('agent-1', 'github') },
    );
    expect(res.status).toBe(400);
  });

  it('[ERROR] 400 when binding oauth provider does not match URL provider slug', async () => {
    mockAgentGetById.mockResolvedValue(
      makeAgentWithOAuthBinding({ provider: 'github' }),
    );

    const res = await POST(
      makePostRequest('agent-1', 'google', 'appsilon', { serverName: 'gh' }),
      { params: makeParams('agent-1', 'google') },
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain('google');
    expect(mockProviderGet).not.toHaveBeenCalled();
  });

  it('[ERROR] 404 when provider is not configured in namespace', async () => {
    mockAgentGetById.mockResolvedValue(makeAgentWithOAuthBinding());
    mockProviderGet.mockResolvedValue(null);

    const res = await POST(
      makePostRequest('agent-1', 'github', 'appsilon', { serverName: 'gh' }),
      { params: makeParams('agent-1', 'github') },
    );
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.error).toContain('github');
    expect(json.error).toContain('appsilon');
  });

  it('[ERROR] 500 when neither OAUTH_STATE_SECRET nor PLATFORM_API_KEY is configured', async () => {
    process.env.PLATFORM_API_KEY = '';
    const previousOAuthSecret = process.env.OAUTH_STATE_SECRET;
    delete process.env.OAUTH_STATE_SECRET;
    try {
      mockAgentGetById.mockResolvedValue(makeAgentWithOAuthBinding());
      mockProviderGet.mockResolvedValue(providerConfig);

      const res = await POST(
        makePostRequest('agent-1', 'github', 'appsilon', { serverName: 'gh' }),
        { params: makeParams('agent-1', 'github') },
      );
      expect(res.status).toBe(500);
    } finally {
      if (previousOAuthSecret === undefined) delete process.env.OAUTH_STATE_SECRET;
      else process.env.OAUTH_STATE_SECRET = previousOAuthSecret;
    }
  });

  it('[AUTHZ] caller who is not a member of the namespace gets 404', async () => {
    mockGetMember.mockResolvedValue(null);

    const res = await POST(
      makePostRequest('agent-1', 'github', 'other-ns', { serverName: 'gh' }),
      { params: makeParams('agent-1', 'github') },
    );
    expect(res.status).toBe(404);
    expect(mockAgentGetById).not.toHaveBeenCalled();
    expect(mockProviderGet).not.toHaveBeenCalled();
  });

  it('[AUTHZ] membership check uses the query-param namespace', async () => {
    mockAgentGetById.mockResolvedValue(makeAgentWithOAuthBinding());
    mockProviderGet.mockResolvedValue(providerConfig);

    await POST(
      makePostRequest('agent-1', 'github', 'other-ns', { serverName: 'gh' }),
      { params: makeParams('agent-1', 'github') },
    );
    expect(mockGetMember).toHaveBeenCalledWith('other-ns', 'user-firebase-uid');
  });

  it('[SECRETS] prefers OAUTH_STATE_SECRET over PLATFORM_API_KEY', async () => {
    process.env.OAUTH_STATE_SECRET = 'dedicated-state-secret';
    try {
      mockAgentGetById.mockResolvedValue(makeAgentWithOAuthBinding());
      mockProviderGet.mockResolvedValue(providerConfig);

      const res = await POST(
        makePostRequest('agent-1', 'github', 'appsilon', { serverName: 'gh' }),
        { params: makeParams('agent-1', 'github') },
      );
      const json = (await res.json()) as { state: string };
      expect(res.status).toBe(200);

      // State signed with the dedicated secret — verifies with that key,
      // not with PLATFORM_API_KEY.
      const payload = await verifyState(json.state, 'dedicated-state-secret', 60_000);
      expect(payload).not.toBeNull();
      expect(payload?.namespace).toBe('appsilon');

      const withWrongKey = await verifyState(json.state, 'test-platform-secret', 60_000);
      expect(withWrongKey).toBeNull();
    } finally {
      delete process.env.OAUTH_STATE_SECRET;
    }
  });

  it('[SECRETS] falls back to PLATFORM_API_KEY when OAUTH_STATE_SECRET unset', async () => {
    delete process.env.OAUTH_STATE_SECRET;
    mockAgentGetById.mockResolvedValue(makeAgentWithOAuthBinding());
    mockProviderGet.mockResolvedValue(providerConfig);

    const res = await POST(
      makePostRequest('agent-1', 'github', 'appsilon', { serverName: 'gh' }),
      { params: makeParams('agent-1', 'github') },
    );
    const json = (await res.json()) as { state: string };
    expect(res.status).toBe(200);

    const payload = await verifyState(json.state, 'test-platform-secret', 60_000);
    expect(payload).not.toBeNull();
  });
});
