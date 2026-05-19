import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindMostRecentActive = vi.fn();
const mockInstanceGetById = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    coworkSessionRepo: { findMostRecentActive: mockFindMostRecentActive },
    instanceRepo: { getById: mockInstanceGetById },
    namespaceRepo: {},
  }),
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

function makeRequest(instanceId: string) {
  const req = new Request(`http://localhost/api/cowork/by-instance/${instanceId}`, {
    headers: { 'X-Api-Key': 'test-key' },
  });
  return { req, params: Promise.resolve({ instanceId }) };
}

const sessionFixture = {
  id: 'sess-1',
  processInstanceId: 'inst-1',
  status: 'active',
  turns: [],
  artifact: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('GET /api/cowork/by-instance/[instanceId]', () => {
  beforeEach(() => {
    mockFindMostRecentActive.mockReset();
    mockInstanceGetById.mockReset();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey' });
  });

  it('[DATA] returns the most recent active session for an instance', async () => {
    mockInstanceGetById.mockResolvedValue({ id: 'inst-1', namespace: 'team-alpha' });
    mockFindMostRecentActive.mockResolvedValue(sessionFixture);
    const { req, params } = makeRequest('inst-1');

    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('sess-1');
  });

  it('[ERROR] returns 404 when instance not found', async () => {
    mockInstanceGetById.mockResolvedValue(null);
    const { req, params } = makeRequest('missing');

    const res = await GET(req, { params });

    expect(res.status).toBe(404);
  });

  it('[AUTH] returns 404 (not 403) when user is not a member of the instance namespace (anti-enumeration)', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'outsider',
      namespaces: new Set(['other-ns']),
    });
    mockInstanceGetById.mockResolvedValue({ id: 'inst-1', namespace: 'team-alpha' });
    mockFindMostRecentActive.mockResolvedValue(sessionFixture);
    const { req, params } = makeRequest('inst-1');

    const res = await GET(req, { params });

    expect(res.status).toBe(404);
  });
});
