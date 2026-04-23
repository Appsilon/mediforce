import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type {
  AgentDefinition,
  AgentOAuthToken,
  Namespace,
  OAuthProviderConfig,
} from '@mediforce/platform-core';
import {
  InMemoryAgentOAuthTokenRepository,
  InMemoryOAuthProviderRepository,
} from '@mediforce/platform-core/testing';

// ---- Shared state + fake platform services ----
//
// `vi.hoisted` so the state and its closures exist before `vi.mock`'s
// factory is evaluated — same pattern as mcp-journey.test.ts.
const fake = vi.hoisted(() => {
  const agents = new Map<string, unknown>();
  const namespaces = new Map<string, unknown>();
  const oauthProviderRepo = {} as unknown;
  const agentOAuthTokenRepo = {} as unknown;

  const services = {
    namespaceRepo: {
      getNamespace: async (handle: string) => namespaces.get(handle) ?? null,
    },
    agentDefinitionRepo: {
      getById: async (id: string) => agents.get(id) ?? null,
    },
    oauthProviderRepo,
    agentOAuthTokenRepo,
  };

  return {
    state: { agents, namespaces },
    services,
    // Replaced per-test by `beforeEach` so each test has fresh repos.
    setRepos(options: {
      oauthProviderRepo: unknown;
      agentOAuthTokenRepo: unknown;
    }): void {
      (services as { oauthProviderRepo: unknown }).oauthProviderRepo = options.oauthProviderRepo;
      (services as { agentOAuthTokenRepo: unknown }).agentOAuthTokenRepo = options.agentOAuthTokenRepo;
    },
  };
});

const mockVerifyIdToken = vi.hoisted(() => vi.fn());

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => fake.services,
}));

vi.mock('@mediforce/platform-infra', () => ({
  getAdminAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

// Route handlers imported AFTER vi.mock declarations so they resolve the
// aliased `@/lib/platform-services` and `@mediforce/platform-infra` to the
// fakes above.
import * as adminProvidersRoute from '@/app/api/admin/oauth-providers/route';
import * as oauthStartRoute from '@/app/api/agents/[id]/oauth/[provider]/start/route';
import * as oauthTokenRoute from '@/app/api/agents/[id]/oauth/[provider]/route';
import * as oauthListRoute from '@/app/api/agents/[id]/oauth/route';
import * as oauthCallbackRoute from '@/app/api/oauth/[provider]/callback/route';

// ---- Fixtures ----

const APPSILON: Namespace = {
  handle: 'appsilon',
  type: 'organization',
  displayName: 'Appsilon',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const UID = 'firebase-uid-1';
const PLATFORM_SECRET = 'test-platform-secret';

const providerCreateInput = {
  id: 'github',
  name: 'GitHub',
  clientId: 'client-id-xyz',
  clientSecret: 'client-secret-xyz',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  revokeUrl: 'https://api.github.com/applications/client-id-xyz/token',
  userInfoUrl: 'https://api.github.com/user',
  scopes: ['repo', 'read:user'],
};

function buildAgentWithOAuthBinding(): AgentDefinition {
  return {
    id: 'agent-1',
    kind: 'plugin',
    runtimeId: 'claude-code-agent',
    name: 'Journey Agent',
    iconName: 'Bot',
    description: '',
    foundationModel: 'anthropic/claude-sonnet-4',
    systemPrompt: '',
    inputDescription: '',
    outputDescription: '',
    skillFileNames: [],
    mcpServers: {
      gh: {
        type: 'http',
        url: 'https://api.example.com/mcp',
        auth: {
          type: 'oauth',
          provider: 'github',
          headerName: 'Authorization',
          headerValueTemplate: 'Bearer {token}',
        },
      },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function tokenExchangeResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      access_token: 'gho_journey_access',
      refresh_token: 'gho_journey_refresh',
      expires_in: 3600,
      scope: 'repo read:user',
      token_type: 'bearer',
      ...overrides,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function userInfoResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({ id: 10001, login: 'journey-user', ...overrides }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// ---- HTTP helpers ----

function adminListProviders(ns: string): Promise<Response> {
  const url = new URL(`http://localhost/api/admin/oauth-providers?namespace=${ns}`);
  return Promise.resolve(adminProvidersRoute.GET(new NextRequest(url.toString())));
}

function adminCreateProvider(ns: string, body: unknown): Promise<Response> {
  const url = new URL(`http://localhost/api/admin/oauth-providers?namespace=${ns}`);
  const req = new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return Promise.resolve(adminProvidersRoute.POST(req));
}

function userStartOAuth(
  agentId: string,
  providerSlug: string,
  ns: string,
  serverName: string,
): Promise<Response> {
  const url = new URL(
    `http://localhost/api/agents/${agentId}/oauth/${providerSlug}/start?namespace=${ns}`,
  );
  const req = new NextRequest(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer valid-token',
    },
    body: JSON.stringify({ serverName }),
  });
  return Promise.resolve(
    oauthStartRoute.POST(req, {
      params: Promise.resolve({ id: agentId, provider: providerSlug }),
    }),
  );
}

function userCallback(
  providerSlug: string,
  state: string,
  code: string,
): Promise<Response> {
  const url = new URL(
    `http://localhost/api/oauth/${providerSlug}/callback?code=${code}&state=${encodeURIComponent(state)}`,
  );
  const req = new NextRequest(url.toString());
  return Promise.resolve(
    oauthCallbackRoute.GET(req, {
      params: Promise.resolve({ provider: providerSlug }),
    }),
  );
}

function userListOAuthTokens(agentId: string, ns: string): Promise<Response> {
  const url = new URL(
    `http://localhost/api/agents/${agentId}/oauth?namespace=${ns}`,
  );
  const req = new NextRequest(url.toString(), {
    method: 'GET',
    headers: { Authorization: 'Bearer valid-token' },
  });
  return Promise.resolve(
    oauthListRoute.GET(req, { params: Promise.resolve({ id: agentId }) }),
  );
}

function userDeleteToken(
  agentId: string,
  providerSlug: string,
  ns: string,
  serverName: string,
  revokeAtProvider: boolean,
): Promise<Response> {
  const url = new URL(
    `http://localhost/api/agents/${agentId}/oauth/${providerSlug}?namespace=${ns}&serverName=${serverName}&revokeAtProvider=${revokeAtProvider}`,
  );
  const req = new NextRequest(url.toString(), {
    method: 'DELETE',
    headers: { Authorization: 'Bearer valid-token' },
  });
  return Promise.resolve(
    oauthTokenRoute.DELETE(req, {
      params: Promise.resolve({ id: agentId, provider: providerSlug }),
    }),
  );
}

// ---- Tests ----

describe('MCP OAuth journey — admin CRUD + user connect flow + disconnect/revoke', () => {
  const originalKey = process.env.PLATFORM_API_KEY;
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;
  let providerRepo: InMemoryOAuthProviderRepository;
  let tokenRepo: InMemoryAgentOAuthTokenRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PLATFORM_API_KEY = PLATFORM_SECRET;
    mockVerifyIdToken.mockResolvedValue({ uid: UID });

    // Fresh repos per test, attached to the shared services closure.
    providerRepo = new InMemoryOAuthProviderRepository();
    tokenRepo = new InMemoryAgentOAuthTokenRepository();
    fake.setRepos({
      oauthProviderRepo: providerRepo,
      agentOAuthTokenRepo: tokenRepo,
    });

    // Seed baseline namespace + agent.
    fake.state.namespaces.clear();
    fake.state.agents.clear();
    fake.state.namespaces.set(APPSILON.handle, APPSILON);
    fake.state.agents.set('agent-1', buildAgentWithOAuthBinding());

    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    process.env.PLATFORM_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
  });

  it('[JOURNEY] admin registers GitHub provider, user connects, disconnects, reconnects, and revokes', async () => {
    // 1. Admin creates the OAuth provider config.
    const createRes = await adminCreateProvider('appsilon', providerCreateInput);
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { provider: OAuthProviderConfig };
    expect(created.provider.id).toBe('github');

    // 2. User lists providers — sees GitHub.
    const listRes = await adminListProviders('appsilon');
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { providers: OAuthProviderConfig[] };
    expect(listBody.providers).toHaveLength(1);
    expect(listBody.providers[0].id).toBe('github');

    // 3. User's agent has an OAuth HTTP binding seeded via in-memory repo
    //    in `beforeEach` — we don't re-POST here.

    // 4. User requests an OAuth authorize URL.
    const startRes1 = await userStartOAuth('agent-1', 'github', 'appsilon', 'gh');
    expect(startRes1.status).toBe(200);
    const startBody1 = (await startRes1.json()) as { authorizeUrl: string; state: string };
    expect(startBody1.state).toBeTruthy();
    const authorizeUrl1 = new URL(startBody1.authorizeUrl);
    expect(authorizeUrl1.origin).toBe('https://github.com');
    expect(authorizeUrl1.searchParams.get('client_id')).toBe('client-id-xyz');
    expect(authorizeUrl1.searchParams.get('state')).toBe(startBody1.state);

    // 5. Provider redirects to callback — we mock token exchange + userinfo.
    fetchMock.mockResolvedValueOnce(tokenExchangeResponse());
    fetchMock.mockResolvedValueOnce(userInfoResponse());

    const callbackRes1 = await userCallback('github', startBody1.state, 'first-code');
    expect(callbackRes1.status).toBe(302);
    const redirectLocation1 = callbackRes1.headers.get('Location') ?? '';
    expect(redirectLocation1).toContain('/appsilon/agents/definitions/agent-1');
    expect(redirectLocation1).toContain('connected=gh');

    const stored1 = await tokenRepo.get('appsilon', 'agent-1', 'gh');
    expect(stored1).not.toBeNull();
    expect(stored1?.accessToken).toBe('gho_journey_access');
    expect(stored1?.refreshToken).toBe('gho_journey_refresh');
    expect(stored1?.accountLogin).toBe('journey-user');

    // 6. User lists agent OAuth status — sees connected.
    const tokenListRes1 = await userListOAuthTokens('agent-1', 'appsilon');
    expect(tokenListRes1.status).toBe(200);
    const tokenList1 = (await tokenListRes1.json()) as {
      tokens: Array<Record<string, unknown>>;
    };
    expect(tokenList1.tokens).toHaveLength(1);
    expect(tokenList1.tokens[0].serverName).toBe('gh');
    expect(tokenList1.tokens[0].accountLogin).toBe('journey-user');
    expect(tokenList1.tokens[0]).not.toHaveProperty('accessToken');

    // 7. User disconnects with revokeAtProvider=false.
    const disconnectRes = await userDeleteToken(
      'agent-1',
      'github',
      'appsilon',
      'gh',
      false,
    );
    expect(disconnectRes.status).toBe(200);
    expect(await tokenRepo.get('appsilon', 'agent-1', 'gh')).toBeNull();

    // Provider revoke was NOT called.
    const revokeUrls = fetchMock.mock.calls
      .map(([url]) => url as string)
      .filter((url) => url === providerCreateInput.revokeUrl);
    expect(revokeUrls).toHaveLength(0);

    // 8. User re-runs start + callback → reconnected.
    const startRes2 = await userStartOAuth('agent-1', 'github', 'appsilon', 'gh');
    const startBody2 = (await startRes2.json()) as { state: string };

    fetchMock.mockResolvedValueOnce(
      tokenExchangeResponse({ access_token: 'second_access', refresh_token: 'second_refresh' }),
    );
    fetchMock.mockResolvedValueOnce(
      userInfoResponse({ id: 10001, login: 'journey-user' }),
    );

    const callbackRes2 = await userCallback('github', startBody2.state, 'second-code');
    expect(callbackRes2.status).toBe(302);

    const stored2 = await tokenRepo.get('appsilon', 'agent-1', 'gh');
    expect(stored2?.accessToken).toBe('second_access');

    // 9. User revokes with revokeAtProvider=true.
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const revokeRes = await userDeleteToken(
      'agent-1',
      'github',
      'appsilon',
      'gh',
      true,
    );
    expect(revokeRes.status).toBe(200);
    expect(await tokenRepo.get('appsilon', 'agent-1', 'gh')).toBeNull();

    // Verify provider revoke endpoint was POSTed exactly once with the token.
    const revokeCalls = fetchMock.mock.calls.filter(
      ([url]) => (url as string) === providerCreateInput.revokeUrl,
    );
    expect(revokeCalls).toHaveLength(1);
    const [, revokeInit] = revokeCalls[0] as [string, RequestInit];
    const revokeBody = (revokeInit.body as string) ?? '';
    expect(revokeBody).toContain('token=second_access');
  });

  it('[JOURNEY] tampered state at callback aborts the flow — no token persisted', async () => {
    await adminCreateProvider('appsilon', providerCreateInput);

    const startRes = await userStartOAuth('agent-1', 'github', 'appsilon', 'gh');
    const startBody = (await startRes.json()) as { state: string };

    // Corrupt the state signature and submit.
    const tampered = `${startBody.state.slice(0, -1)}A`;
    const callbackRes = await userCallback('github', tampered, 'code-x');
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get('Location') ?? '').toContain(
      'oauthError=invalid-state',
    );

    expect(await tokenRepo.get('appsilon', 'agent-1', 'gh')).toBeNull();
    // No token/userinfo fetches were issued.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('[JOURNEY] start fails when provider is not configured in namespace', async () => {
    // No admin create — only the agent exists.
    const startRes = await userStartOAuth('agent-1', 'github', 'appsilon', 'gh');
    expect(startRes.status).toBe(404);
    const body = (await startRes.json()) as { error: string };
    expect(body.error).toContain('github');
  });

  it('[JOURNEY] token list shape is UI-safe — never contains secrets', async () => {
    await adminCreateProvider('appsilon', providerCreateInput);

    // Persist a token directly via the repo (simulate a prior connect).
    const token: AgentOAuthToken = {
      provider: 'github',
      accessToken: 'should-not-leak',
      refreshToken: 'should-not-leak-either',
      expiresAt: Date.now() + 3600_000,
      scope: 'repo read:user',
      providerUserId: '999',
      accountLogin: 'leak-test',
      connectedAt: Date.now(),
      connectedBy: UID,
    };
    await tokenRepo.put('appsilon', 'agent-1', 'gh', token);

    const listRes = await userListOAuthTokens('agent-1', 'appsilon');
    const body = (await listRes.json()) as { tokens: Array<Record<string, unknown>> };
    expect(body.tokens).toHaveLength(1);
    const serialized = JSON.stringify(body.tokens[0]);
    expect(serialized).not.toContain('should-not-leak');
    expect(body.tokens[0]).not.toHaveProperty('accessToken');
    expect(body.tokens[0]).not.toHaveProperty('refreshToken');
  });
});
