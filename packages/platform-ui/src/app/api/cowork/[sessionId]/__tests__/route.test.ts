import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSessionGetById = vi.fn();
const mockInstanceGetById = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    coworkSessionRepo: { getById: mockSessionGetById },
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

function makeRequest(sessionId: string) {
  const req = new Request(`http://localhost/api/cowork/${sessionId}`, {
    headers: { 'X-Api-Key': 'test-key' },
  });
  return { req, params: Promise.resolve({ sessionId }) };
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

describe('GET /api/cowork/[sessionId]', () => {
  beforeEach(() => {
    mockSessionGetById.mockReset();
    mockInstanceGetById.mockReset();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey' });
  });

  it('[DATA] returns the session for api-key callers', async () => {
    mockSessionGetById.mockResolvedValue(sessionFixture);
    mockInstanceGetById.mockResolvedValue({ id: 'inst-1', namespace: 'team-alpha' });
    const { req, params } = makeRequest('sess-1');

    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('sess-1');
  });

  it('[ERROR] returns 404 when session not found', async () => {
    mockSessionGetById.mockResolvedValue(null);
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
    mockSessionGetById.mockResolvedValue(sessionFixture);
    mockInstanceGetById.mockResolvedValue({ id: 'inst-1', namespace: 'team-alpha' });
    const { req, params } = makeRequest('sess-1');

    const res = await GET(req, { params });

    expect(res.status).toBe(404);
  });
});
