import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetById = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    agentDefinitionRepo: { getById: mockGetById },
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

function makeRequest(id: string) {
  const req = new Request(`http://localhost/api/agent-definitions/${id}`, {
    headers: { 'X-Api-Key': 'test-key' },
  });
  return { req, params: Promise.resolve({ id }) };
}

const baseAgent = {
  id: 'a-1',
  kind: 'plugin' as const,
  runtimeId: 'claude-code-agent',
  name: 'A',
  iconName: 'robot',
  description: 'd',
  foundationModel: 'gpt-4',
  systemPrompt: 's',
  inputDescription: 'i',
  outputDescription: 'o',
  skillFileNames: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('GET /api/agent-definitions/[id]', () => {
  beforeEach(() => {
    mockGetById.mockReset();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey' });
  });

  it('[DATA] returns the agent wrapped in { agent }', async () => {
    mockGetById.mockResolvedValue({
      ...baseAgent,
      namespace: 'team-alpha',
      visibility: 'public',
    });
    const { req, params } = makeRequest('a-1');

    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent.id).toBe('a-1');
  });

  it('[ERROR] returns 404 when the id is unknown', async () => {
    mockGetById.mockResolvedValue(null);
    const { req, params } = makeRequest('missing');

    const res = await GET(req, { params });

    expect(res.status).toBe(404);
  });

  it('[AUTH] returns 404 (not 403) when user reads a private agent outside their namespace', async () => {
    // Anti-enumeration: visibility-denied surfaces as 404, identical to a
    // genuinely-missing agent.
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'outsider',
      namespaces: new Set(['team-beta']),
    });
    mockGetById.mockResolvedValue({
      ...baseAgent,
      namespace: 'team-alpha',
      visibility: 'private',
    });
    const { req, params } = makeRequest('a-1');

    const res = await GET(req, { params });

    expect(res.status).toBe(404);
  });
});
