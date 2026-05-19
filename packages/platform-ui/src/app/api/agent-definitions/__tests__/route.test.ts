import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAgentList = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    agentDefinitionRepo: { list: mockAgentList },
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

function makeRequest() {
  return new Request('http://localhost/api/agent-definitions', {
    headers: { 'X-Api-Key': 'test-key' },
  });
}

const publicAgent = {
  id: 'a-public',
  kind: 'plugin' as const,
  runtimeId: 'claude-code-agent',
  name: 'Public Agent',
  iconName: 'robot',
  description: 'd',
  foundationModel: 'gpt-4',
  systemPrompt: 's',
  inputDescription: 'i',
  outputDescription: 'o',
  skillFileNames: [],
  visibility: 'public' as const,
  namespace: 'team-alpha',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const privateAgent = {
  ...publicAgent,
  id: 'a-private',
  name: 'Private Agent',
  visibility: 'private' as const,
};

describe('GET /api/agent-definitions', () => {
  beforeEach(() => {
    mockAgentList.mockReset();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey' });
  });

  it('[DATA] returns every agent for api-key callers wrapped in { agents }', async () => {
    mockAgentList.mockResolvedValue([publicAgent, privateAgent]);

    const res = await GET(makeRequest(), undefined);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toHaveLength(2);
  });

  it('[AUTH] filters private agents outside the user’s namespace', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'outsider',
      namespaces: new Set(['team-beta']),
    });
    mockAgentList.mockResolvedValue([publicAgent, privateAgent]);

    const res = await GET(makeRequest(), undefined);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].id).toBe('a-public');
  });
});
