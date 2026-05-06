import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  InMemoryConnectionRepository,
  InMemoryOAuthProviderRepository,
  type Namespace,
} from '@mediforce/platform-core';
import {
  signState,
  generateNonce,
  resolveConnectionEnv,
} from '@mediforce/agent-runtime';

const PLATFORM_SECRET = 'unit-test-platform-secret';
const NS = 'appsilon';

// ---- Hoisted shared state for the in-memory platform-services fake ----

const fake = vi.hoisted(() => {
  const adminAuth = {
    verifyIdToken: async (_token: string) => ({ uid: 'uid-admin' }),
  };
  return { adminAuth };
});

const mockNamespaceGet = vi.fn();
const mockGetMember = vi.fn();
const connectionRepo = new InMemoryConnectionRepository();
const providerRepo = new InMemoryOAuthProviderRepository();

vi.mock('@mediforce/platform-infra', () => ({
  getAdminAuth: () => fake.adminAuth,
}));

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    namespaceRepo: { getNamespace: mockNamespaceGet, getMember: mockGetMember },
    connectionRepo,
    oauthProviderRepo: providerRepo,
    agentOAuthTokenRepo: { put: vi.fn() },
  }),
}));

// Routes — imported AFTER vi.mock so they bind to the fake.
import { POST as CREATE_CONNECTION, GET as LIST_CONNECTIONS } from '@/app/api/admin/connections/route';
import { GET as GET_CONNECTION, DELETE as DELETE_CONNECTION } from '@/app/api/admin/connections/[id]/route';
import { POST as START_OAUTH } from '@/app/api/admin/connections/[id]/oauth/start/route';
import { GET as OAUTH_CALLBACK } from '@/app/api/oauth/[provider]/callback/route';

const APPSILON: Namespace = {
  handle: NS,
  type: 'organization',
  displayName: 'Appsilon',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function jsonReq(method: string, path: string, body?: unknown): NextRequest {
  const url = new URL(`http://localhost${path}`);
  const headers: Record<string, string> = { Authorization: 'Bearer admin-token' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new NextRequest(url.toString(), {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  connectionRepo.clear();
  for (const p of await providerRepo.list(NS)) await providerRepo.delete(NS, p.id);
  process.env.PLATFORM_API_KEY = PLATFORM_SECRET;
  mockNamespaceGet.mockResolvedValue(APPSILON);
  mockGetMember.mockResolvedValue({
    uid: 'uid-admin',
    role: 'admin',
    joinedAt: '2026-01-01T00:00:00.000Z',
  });

  await providerRepo.create(NS, {
    id: 'github',
    name: 'GitHub',
    clientId: 'cid',
    clientSecret: 'csec',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['repo', 'read:user'],
    envAlias: ['GITHUB_TOKEN'],
  });
});

describe('Connection lifecycle journey — admin API composed with runtime helpers', () => {
  it('[JOURNEY] create → list → start OAuth → callback → resolveConnectionEnv yields fresh GITHUB_TOKEN', async () => {
    // 1. Admin creates a Connection via REST.
    const createRes = await CREATE_CONNECTION(
      jsonReq('POST', `/api/admin/connections?namespace=${NS}`, {
        id: 'github-mediforce',
        name: 'GitHub (Mediforce)',
        auth: { type: 'oauth', providerId: 'github' },
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()).connection;
    expect(created.id).toBe('github-mediforce');
    expect(created.auth.accessToken).toBeUndefined(); // never connected yet

    // 2. List endpoint surfaces it.
    const listRes = await LIST_CONNECTIONS(jsonReq('GET', `/api/admin/connections?namespace=${NS}`));
    const listBody = await listRes.json();
    expect(listBody.connections.map((c: { id: string }) => c.id)).toEqual(['github-mediforce']);

    // 3. Admin clicks "Connect" — start endpoint returns authorize URL + state.
    const startRes = await START_OAUTH(
      jsonReq('POST', `/api/admin/connections/github-mediforce/oauth/start?namespace=${NS}`),
      { params: Promise.resolve({ id: 'github-mediforce' }) },
    );
    expect(startRes.status).toBe(200);
    const { authorizeUrl, state } = await startRes.json();
    expect(authorizeUrl).toContain('github.com/login/oauth/authorize');
    expect(state).toMatch(/\..+/);

    // 4. Provider redirects to /api/oauth/github/callback with code+state.
    //    Stub the token + userinfo fetches the callback performs.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('https://github.com/login/oauth/access_token')) {
        return new Response(
          JSON.stringify({
            access_token: 'gho_FRESH',
            refresh_token: 'ghr_FRESH',
            expires_in: 3600,
            scope: 'repo,read:user',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.startsWith('https://api.github.com/user')) {
        return new Response(
          JSON.stringify({ id: 12345, login: 'octocat' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected fetch in journey: ${url}`);
    }) as typeof fetch;

    try {
      const callbackUrl = new URL('http://localhost/api/oauth/github/callback');
      callbackUrl.searchParams.set('code', 'auth-code-from-provider');
      callbackUrl.searchParams.set('state', state);
      const callbackRes = await OAUTH_CALLBACK(
        new NextRequest(callbackUrl.toString()),
        { params: Promise.resolve({ provider: 'github' }) },
      );
      expect(callbackRes.status).toBe(302);
      const location = callbackRes.headers.get('Location') ?? '';
      expect(location).toContain(`/${NS}/admin/connections/github-mediforce`);
      expect(location).toContain('connected=true');
    } finally {
      globalThis.fetch = originalFetch;
    }

    // 5. Public list response NEVER carries access tokens — even after connect.
    const reGet = await GET_CONNECTION(
      jsonReq('GET', `/api/admin/connections/github-mediforce?namespace=${NS}`),
      { params: Promise.resolve({ id: 'github-mediforce' }) },
    );
    const reBody = await reGet.json();
    expect(reBody.connection.auth.accessToken).toBeUndefined();
    expect(reBody.connection.auth.refreshToken).toBeUndefined();
    expect(reBody.connection.auth.accountLogin).toBe('octocat');
    expect(reBody.connection.auth.expiresAt).toBeGreaterThan(Date.now());

    // 6. Runtime helper now resolves the right env bundle for a script step
    //    that references this Connection.
    const env = await resolveConnectionEnv(NS, ['github-mediforce'], {
      connectionRepo,
      oauthProviderRepo: providerRepo,
    });
    expect(env.vars).toEqual({
      CONN_GITHUB_MEDIFORCE_TOKEN: 'gho_FRESH',
      GITHUB_TOKEN: 'gho_FRESH',
    });
  });

  it('[JOURNEY] DELETE removes the connection and the env helper then refuses with StepConnectionMissingError', async () => {
    await CREATE_CONNECTION(
      jsonReq('POST', `/api/admin/connections?namespace=${NS}`, {
        id: 'github-mediforce',
        name: 'GH',
        auth: { type: 'oauth', providerId: 'github' },
      }),
    );
    const delRes = await DELETE_CONNECTION(
      jsonReq('DELETE', `/api/admin/connections/github-mediforce?namespace=${NS}`),
      { params: Promise.resolve({ id: 'github-mediforce' }) },
    );
    expect(delRes.status).toBe(200);

    await expect(
      resolveConnectionEnv(NS, ['github-mediforce'], {
        connectionRepo,
        oauthProviderRepo: providerRepo,
      }),
    ).rejects.toThrow(/does not exist/);
  });

  it('[JOURNEY] state HMAC tampering is rejected at the callback', async () => {
    await CREATE_CONNECTION(
      jsonReq('POST', `/api/admin/connections?namespace=${NS}`, {
        id: 'github-mediforce',
        name: 'GH',
        auth: { type: 'oauth', providerId: 'github' },
      }),
    );

    // Mint a state with a DIFFERENT secret — callback recomputes HMAC and
    // rejects it as invalid-state.
    const badState = await signState(
      {
        namespace: NS,
        connectionId: 'github-mediforce',
        providerId: 'github',
        connectedBy: 'attacker',
        ts: Date.now(),
        nonce: generateNonce(),
      },
      'wrong-secret',
    );

    const callbackUrl = new URL('http://localhost/api/oauth/github/callback');
    callbackUrl.searchParams.set('code', 'attacker-code');
    callbackUrl.searchParams.set('state', badState);
    const res = await OAUTH_CALLBACK(
      new NextRequest(callbackUrl.toString()),
      { params: Promise.resolve({ provider: 'github' }) },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('oauthError=invalid-state');

    // Connection never received tokens.
    const refetched = await connectionRepo.getById(NS, 'github-mediforce');
    if (refetched?.auth.type === 'oauth') {
      expect(refetched.auth.accessToken).toBeUndefined();
    }
  });
});
