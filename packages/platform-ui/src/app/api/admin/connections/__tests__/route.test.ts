import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { InMemoryConnectionRepository } from '@mediforce/platform-core';

// ---- Mocks ----

const mockVerifyIdToken = vi.fn();
const mockNamespaceGet = vi.fn();
const mockGetMember = vi.fn();
const connectionRepo = new InMemoryConnectionRepository();

vi.mock('@mediforce/platform-infra', () => ({
  getAdminAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    namespaceRepo: {
      getNamespace: mockNamespaceGet,
      getMember: mockGetMember,
    },
    connectionRepo,
  }),
}));

import { GET as LIST, POST as CREATE } from '../route';
import { GET as GET_ONE, PATCH, DELETE as DELETE_ONE } from '../[id]/route';

// ---- Helpers ----

const NS = 'appsilon';
const ADMIN_AUTH = 'Bearer valid-token';

const namespaceDoc = {
  handle: NS,
  type: 'organization',
  displayName: 'Appsilon',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const adminMember = { uid: 'uid-admin', role: 'admin' as const, joinedAt: '2026-01-01T00:00:00.000Z' };
const plainMember = { ...adminMember, role: 'member' as const };

function url(path = '', namespace: string | null = NS): URL {
  const u = new URL(`http://localhost/api/admin/connections${path}`);
  if (namespace !== null) u.searchParams.set('namespace', namespace);
  return u;
}

function get(path = '', namespace: string | null = NS, auth: string | null = ADMIN_AUTH): NextRequest {
  const headers: Record<string, string> = {};
  if (auth !== null) headers.Authorization = auth;
  return new NextRequest(url(path, namespace).toString(), { headers });
}

function post(body: unknown, namespace: string | null = NS, auth: string | null = ADMIN_AUTH): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth !== null) headers.Authorization = auth;
  return new NextRequest(url('', namespace).toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function patch(path: string, body: unknown, namespace: string | null = NS, auth: string | null = ADMIN_AUTH): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth !== null) headers.Authorization = auth;
  return new NextRequest(url(path, namespace).toString(), {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
}

function del(path: string, namespace: string | null = NS, auth: string | null = ADMIN_AUTH): NextRequest {
  const headers: Record<string, string> = {};
  if (auth !== null) headers.Authorization = auth;
  return new NextRequest(url(path, namespace).toString(), { method: 'DELETE', headers });
}

const oauthInput = {
  id: 'github-mediforce',
  name: 'GitHub (Mediforce)',
  auth: { type: 'oauth' as const, providerId: 'github' },
};

beforeEach(async () => {
  vi.clearAllMocks();
  connectionRepo.clear();
  mockVerifyIdToken.mockResolvedValue({ uid: 'uid-admin' });
  mockNamespaceGet.mockResolvedValue(namespaceDoc);
  mockGetMember.mockResolvedValue(adminMember);
});

describe('GET /api/admin/connections', () => {
  it('[DATA] returns empty list initially', async () => {
    const res = await LIST(get());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connections).toEqual([]);
  });

  it('[DATA] lists created connections sorted by id', async () => {
    await connectionRepo.create(NS, { id: 'github-personal', name: 'gp', auth: { type: 'oauth', providerId: 'github' } });
    await connectionRepo.create(NS, oauthInput);
    const res = await LIST(get());
    const body = await res.json();
    expect(body.connections.map((c: { id: string }) => c.id)).toEqual([
      'github-mediforce',
      'github-personal',
    ]);
  });

  it('[ERROR] 400 when namespace missing', async () => {
    const res = await LIST(get('', null));
    expect(res.status).toBe(400);
  });

  it('[AUTHZ] 403 for plain member', async () => {
    mockGetMember.mockResolvedValue(plainMember);
    const res = await LIST(get());
    expect(res.status).toBe(403);
  });

  it('[AUTHZ] 401 without token', async () => {
    const res = await LIST(get('', NS, null));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/connections', () => {
  it('[DATA] creates an oauth connection', async () => {
    const res = await CREATE(post(oauthInput));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.connection.id).toBe('github-mediforce');
    expect(body.connection.auth.providerId).toBe('github');
  });

  it('[SECURITY] response strips accessToken / refreshToken even when present in storage', async () => {
    await connectionRepo.create(NS, oauthInput);
    await connectionRepo.setTokens(NS, 'github-mediforce', { accessToken: 'gho_secret_xyz' });
    const res = await GET_ONE(get('/github-mediforce'), { params: Promise.resolve({ id: 'github-mediforce' }) });
    const body = await res.json();
    expect(body.connection.auth.providerId).toBe('github');
    expect(body.connection.auth.accessToken).toBeUndefined();
    expect(body.connection.auth.refreshToken).toBeUndefined();
  });

  it('[SECURITY] LIST response strips token material from every connection', async () => {
    await connectionRepo.create(NS, oauthInput);
    await connectionRepo.setTokens(NS, 'github-mediforce', {
      accessToken: 'gho_secret_xyz',
      refreshToken: 'ghr_secret_xyz',
    });
    const res = await LIST(get(''));
    const body = await res.json();
    expect(body.connections).toHaveLength(1);
    for (const conn of body.connections) {
      expect(conn.auth.accessToken).toBeUndefined();
      expect(conn.auth.refreshToken).toBeUndefined();
    }
  });

  it('[SECURITY] POST refuses to create a Connection with accessToken in auth', async () => {
    const res = await CREATE(post({
      ...oauthInput,
      auth: { type: 'oauth', providerId: 'github', accessToken: 'attacker-token' },
    }));
    expect(res.status).toBe(400);
    expect(await connectionRepo.getById(NS, 'github-mediforce')).toBeNull();
  });

  it('[SECURITY] PATCH refuses to write accessToken into auth (OAuth flow only)', async () => {
    await connectionRepo.create(NS, oauthInput);
    const res = await PATCH(patch('/github-mediforce', {
      auth: { type: 'oauth', providerId: 'github', accessToken: 'attacker-token' },
    }), {
      params: Promise.resolve({ id: 'github-mediforce' }),
    });
    expect(res.status).toBe(400);
    const persisted = await connectionRepo.getById(NS, 'github-mediforce');
    if (persisted?.auth.type === 'oauth') {
      expect(persisted.auth.accessToken).toBeUndefined();
    }
  });

  it('[ERROR] 400 on missing required fields', async () => {
    const res = await CREATE(post({ id: 'gh' }));
    expect(res.status).toBe(400);
  });

  it('[ERROR] 400 on invalid id pattern (uppercase)', async () => {
    const res = await CREATE(post({ ...oauthInput, id: 'GitHubMediforce' }));
    expect(res.status).toBe(400);
  });

  it('[ERROR] 409 on duplicate id', async () => {
    await CREATE(post(oauthInput));
    const res = await CREATE(post(oauthInput));
    expect(res.status).toBe(409);
  });

  it('[ERROR] 400 on non-JSON body', async () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: ADMIN_AUTH };
    const req = new NextRequest(url().toString(), { method: 'POST', headers, body: 'not-json{' });
    const res = await CREATE(req);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/connections/[id]', () => {
  it('[DATA] returns the connection', async () => {
    await connectionRepo.create(NS, oauthInput);
    const res = await GET_ONE(get('/github-mediforce'), { params: Promise.resolve({ id: 'github-mediforce' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connection.name).toBe('GitHub (Mediforce)');
  });

  it('[ERROR] 404 for unknown id', async () => {
    const res = await GET_ONE(get('/nope'), { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/admin/connections/[id]', () => {
  it('[DATA] updates name', async () => {
    await connectionRepo.create(NS, oauthInput);
    const res = await PATCH(patch('/github-mediforce', { name: 'Renamed' }), {
      params: Promise.resolve({ id: 'github-mediforce' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connection.name).toBe('Renamed');
  });

  it('[ERROR] 404 when patching unknown id', async () => {
    const res = await PATCH(patch('/nope', { name: 'x' }), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });

  it('[ERROR] 400 when patch body has unknown id field', async () => {
    await connectionRepo.create(NS, oauthInput);
    const res = await PATCH(patch('/github-mediforce', { id: 'rename' }), {
      params: Promise.resolve({ id: 'github-mediforce' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/admin/connections/[id]', () => {
  it('[DATA] removes the connection', async () => {
    await connectionRepo.create(NS, oauthInput);
    const res = await DELETE_ONE(del('/github-mediforce'), {
      params: Promise.resolve({ id: 'github-mediforce' }),
    });
    expect(res.status).toBe(200);
    const fetched = await connectionRepo.getById(NS, 'github-mediforce');
    expect(fetched).toBeNull();
  });

  it('[ERROR] 404 when deleting unknown id', async () => {
    const res = await DELETE_ONE(del('/nope'), { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });
});
