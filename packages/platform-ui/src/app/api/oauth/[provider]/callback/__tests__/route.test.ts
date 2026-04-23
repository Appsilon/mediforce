import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { signState, generateNonce, type OAuthStatePayload } from '@mediforce/agent-runtime';
import type { AgentOAuthToken, OAuthProviderConfig } from '@mediforce/platform-core';

// ---- Mocks ----

const mockProviderGet = vi.fn();
const mockTokenPut = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    oauthProviderRepo: { get: mockProviderGet },
    agentOAuthTokenRepo: { put: mockTokenPut },
  }),
}));

import { GET } from '../route';

// ---- Helpers ----

const PLATFORM_SECRET = 'test-platform-secret';

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

function buildStatePayload(overrides: Partial<OAuthStatePayload> = {}): OAuthStatePayload {
  return {
    namespace: 'appsilon',
    agentId: 'agent-1',
    serverName: 'gh',
    providerId: 'github',
    connectedBy: 'uid-1',
    ts: Date.now(),
    nonce: generateNonce(),
    ...overrides,
  };
}

async function mintState(overrides: Partial<OAuthStatePayload> = {}): Promise<string> {
  return signState(buildStatePayload(overrides), PLATFORM_SECRET);
}

function makeCallbackRequest(providerSlug: string, search: Record<string, string>): NextRequest {
  const url = new URL(
    `http://localhost/api/oauth/${providerSlug}/callback`,
  );
  for (const [k, v] of Object.entries(search)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString());
}

const makeParams = (provider: string) => Promise.resolve({ provider });

function tokenExchangeResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      access_token: 'gho_accesstoken',
      refresh_token: 'refresh123',
      expires_in: 3600,
      scope: 'repo,read:user',
      token_type: 'bearer',
      ...overrides,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function userInfoResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      id: 12345,
      login: 'testuser',
      ...overrides,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// ---- Tests ----

describe('GET /api/oauth/:provider/callback', () => {
  const originalKey = process.env.PLATFORM_API_KEY;
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PLATFORM_API_KEY = PLATFORM_SECRET;
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    process.env.PLATFORM_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
  });

  it('[DATA] happy path — exchanges code, fetches user info, persists token, 302 redirects to agent editor', async () => {
    const state = await mintState();
    mockProviderGet.mockResolvedValue(providerConfig);
    mockTokenPut.mockResolvedValue(undefined);
    fetchMock.mockResolvedValueOnce(tokenExchangeResponse());
    fetchMock.mockResolvedValueOnce(userInfoResponse());

    const res = await GET(
      makeCallbackRequest('github', { code: 'dummy-code', state }),
      { params: makeParams('github') },
    );

    expect(res.status).toBe(302);
    const location = res.headers.get('Location');
    expect(location).toBeTruthy();
    const parsed = new URL(location ?? '');
    expect(parsed.origin).toBe('http://localhost');
    expect(parsed.pathname).toBe('/appsilon/agents/definitions/agent-1');
    expect(parsed.searchParams.get('connected')).toBe('gh');

    // Token exchange fetch
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe('https://github.com/login/oauth/access_token');
    expect(tokenInit.method).toBe('POST');
    const tokenBody = (tokenInit.body as string) ?? '';
    expect(tokenBody).toContain('grant_type=authorization_code');
    expect(tokenBody).toContain('code=dummy-code');
    // Default token_endpoint_auth_method is client_secret_basic — per RFC 6749
    // §2.3.1, client_id + client_secret are carried in Authorization: Basic,
    // not in the form body.
    expect(tokenBody).not.toContain('client_id=');
    expect(tokenBody).not.toContain('client_secret=');
    const tokenHeaders = tokenInit.headers as Record<string, string>;
    const expectedBasic = `Basic ${Buffer.from('client-id-xyz:client-secret-xyz').toString('base64')}`;
    expect(tokenHeaders.Authorization).toBe(expectedBasic);
    expect(tokenBody).toMatch(/redirect_uri=.*%2Fapi%2Foauth%2Fgithub%2Fcallback/);

    // Userinfo fetch
    const [userInfoUrl, userInfoInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(userInfoUrl).toBe('https://api.github.com/user');
    expect((userInfoInit.headers as Record<string, string>).Authorization).toBe(
      'Bearer gho_accesstoken',
    );

    // Token persisted
    expect(mockTokenPut).toHaveBeenCalledTimes(1);
    const [ns, agentId, serverName, persisted] = mockTokenPut.mock.calls[0] as [
      string,
      string,
      string,
      AgentOAuthToken,
    ];
    expect(ns).toBe('appsilon');
    expect(agentId).toBe('agent-1');
    expect(serverName).toBe('gh');
    expect(persisted.provider).toBe('github');
    expect(persisted.accessToken).toBe('gho_accesstoken');
    expect(persisted.refreshToken).toBe('refresh123');
    expect(persisted.scope).toBe('repo,read:user');
    expect(persisted.providerUserId).toBe('12345');
    expect(persisted.accountLogin).toBe('testuser');
    expect(typeof persisted.expiresAt).toBe('number');
    expect(persisted.connectedBy).toBe('uid-1');
    expect(typeof persisted.connectedAt).toBe('number');
  });

  it('[DATA] connectedBy persisted matches uid from state', async () => {
    const state = await mintState({ connectedBy: 'firebase-uid-xyz' });
    mockProviderGet.mockResolvedValue(providerConfig);
    mockTokenPut.mockResolvedValue(undefined);
    fetchMock.mockResolvedValueOnce(tokenExchangeResponse());
    fetchMock.mockResolvedValueOnce(userInfoResponse());

    await GET(
      makeCallbackRequest('github', { code: 'c', state }),
      { params: makeParams('github') },
    );

    const [, , , persisted] = mockTokenPut.mock.calls[0] as [
      string,
      string,
      string,
      AgentOAuthToken,
    ];
    expect(persisted.connectedBy).toBe('firebase-uid-xyz');
  });

  it('[DATA] falls back to provider.scopes when token response omits scope', async () => {
    const state = await mintState();
    mockProviderGet.mockResolvedValue(providerConfig);
    mockTokenPut.mockResolvedValue(undefined);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'gho_token' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    fetchMock.mockResolvedValueOnce(userInfoResponse());

    await GET(
      makeCallbackRequest('github', { code: 'c', state }),
      { params: makeParams('github') },
    );

    const [, , , persisted] = mockTokenPut.mock.calls[0] as [
      string,
      string,
      string,
      AgentOAuthToken,
    ];
    expect(persisted.scope).toBe('repo read:user');
    expect(persisted.refreshToken).toBeUndefined();
    expect(persisted.expiresAt).toBeUndefined();
  });

  it('[DATA] Google-shape userinfo uses sub + email', async () => {
    const state = await mintState({ providerId: 'google' });
    mockProviderGet.mockResolvedValue({ ...providerConfig, id: 'google' });
    mockTokenPut.mockResolvedValue(undefined);
    fetchMock.mockResolvedValueOnce(tokenExchangeResponse());
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ sub: 'google-sub-123', email: 'user@example.com' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const res = await GET(
      makeCallbackRequest('google', { code: 'c', state }),
      { params: makeParams('google') },
    );
    expect(res.status).toBe(302);

    const [, , , persisted] = mockTokenPut.mock.calls[0] as [
      string,
      string,
      string,
      AgentOAuthToken,
    ];
    expect(persisted.providerUserId).toBe('google-sub-123');
    expect(persisted.accountLogin).toBe('user@example.com');
  });

  it('[ERROR] redirect to error page when code param missing', async () => {
    const state = await mintState();
    const res = await GET(
      makeCallbackRequest('github', { state }),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('oauthError=');
    expect(location).toContain('missing-code-or-state');
    expect(mockTokenPut).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('[ERROR] redirect to error page when state missing', async () => {
    const res = await GET(
      makeCallbackRequest('github', { code: 'dummy' }),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('missing-code-or-state');
    expect(mockTokenPut).not.toHaveBeenCalled();
  });

  it('[ERROR] redirect to error page when PLATFORM_API_KEY is not set', async () => {
    process.env.PLATFORM_API_KEY = '';
    const state = await mintState();
    const res = await GET(
      makeCallbackRequest('github', { code: 'c', state }),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('server-misconfigured');
  });

  it('[ERROR] tampered state returns invalid-state redirect', async () => {
    const state = await mintState();
    // Replace the last byte of the signature to break HMAC verification.
    const tampered = `${state.slice(0, -1)}A`;
    const res = await GET(
      makeCallbackRequest('github', { code: 'c', state: tampered }),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('oauthError=invalid-state');
    expect(mockTokenPut).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('[ERROR] state older than 10 min returns invalid-state redirect', async () => {
    const elevenMinAgo = Date.now() - 11 * 60_000;
    const state = await mintState({ ts: elevenMinAgo });

    const res = await GET(
      makeCallbackRequest('github', { code: 'c', state }),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('oauthError=invalid-state');
    expect(mockTokenPut).not.toHaveBeenCalled();
  });

  it('[ERROR] provider slug mismatch with state.providerId returns provider-mismatch redirect', async () => {
    const state = await mintState({ providerId: 'github' });
    const res = await GET(
      makeCallbackRequest('google', { code: 'c', state }),
      { params: makeParams('google') },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('oauthError=provider-mismatch');
    expect(mockTokenPut).not.toHaveBeenCalled();
  });

  it('[ERROR] provider config no longer exists returns provider-gone redirect', async () => {
    const state = await mintState();
    mockProviderGet.mockResolvedValue(null);

    const res = await GET(
      makeCallbackRequest('github', { code: 'c', state }),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('oauthError=provider-gone');
    expect(mockTokenPut).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('[ERROR] token exchange fetch non-200 returns code-exchange-failed redirect', async () => {
    const state = await mintState();
    mockProviderGet.mockResolvedValue(providerConfig);
    fetchMock.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));

    const res = await GET(
      makeCallbackRequest('github', { code: 'c', state }),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('oauthError=code-exchange-failed');
    expect(mockTokenPut).not.toHaveBeenCalled();
  });

  it('[ERROR] token exchange returns {error} JSON → code-exchange-rejected', async () => {
    const state = await mintState();
    mockProviderGet.mockResolvedValue(providerConfig);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'bad_verification_code', error_description: 'nope' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const res = await GET(
      makeCallbackRequest('github', { code: 'c', state }),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('oauthError=code-exchange-rejected');
    expect(mockTokenPut).not.toHaveBeenCalled();
  });

  it('[ERROR] token exchange response missing access_token → code-exchange-missing-token', async () => {
    const state = await mintState();
    mockProviderGet.mockResolvedValue(providerConfig);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ token_type: 'bearer' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const res = await GET(
      makeCallbackRequest('github', { code: 'c', state }),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('oauthError=code-exchange-missing-token');
    expect(mockTokenPut).not.toHaveBeenCalled();
  });

  it('[ERROR] userinfo fetch non-200 → userinfo-fetch-failed redirect', async () => {
    const state = await mintState();
    mockProviderGet.mockResolvedValue(providerConfig);
    fetchMock.mockResolvedValueOnce(tokenExchangeResponse());
    fetchMock.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));

    const res = await GET(
      makeCallbackRequest('github', { code: 'c', state }),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('oauthError=userinfo-fetch-failed');
    expect(mockTokenPut).not.toHaveBeenCalled();
  });

  it('[ERROR] userinfo with malformed shape → userinfo-fetch-failed redirect', async () => {
    const state = await mintState();
    mockProviderGet.mockResolvedValue(providerConfig);
    fetchMock.mockResolvedValueOnce(tokenExchangeResponse());
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ unrelated: 'fields' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const res = await GET(
      makeCallbackRequest('github', { code: 'c', state }),
      { params: makeParams('github') },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('oauthError=userinfo-fetch-failed');
    expect(mockTokenPut).not.toHaveBeenCalled();
  });
});
