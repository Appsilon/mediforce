import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAgentGetById = vi.fn();
const mockAgentGetByIdVisibleTo = vi.fn();
const mockGetNamespacesByUser = vi.fn().mockResolvedValue([]);

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    agentDefinitionRepo: {
      getById: mockAgentGetById,
      getByIdVisibleTo: mockAgentGetByIdVisibleTo,
    },
    namespaceRepo: { getNamespacesByUser: mockGetNamespacesByUser },
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

const makeParams = (id: string) => Promise.resolve({ id });

const coworkAgent = {
  id: 'tealflow-cowork-chat',
  kind: 'cowork',
  runtimeId: 'chat',
  name: 'TealFlow Cowork',
  iconName: 'Bot',
  description: '',
  foundationModel: 'anthropic/claude-sonnet-4',
  systemPrompt: '',
  inputDescription: '',
  outputDescription: '',
  skillFileNames: [],
  mcpServers: {
    tealflow: { type: 'stdio', catalogId: 'tealflow-mcp' },
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('GET /api/agents/:id/mcp-servers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
  });

  it('[DATA] returns mcpServers for a cowork agent', async () => {
    mockAgentGetById.mockResolvedValue(coworkAgent);

    const req = new NextRequest('http://localhost/api/agents/tealflow-cowork-chat/mcp-servers');
    const res = await GET(req, { params: makeParams('tealflow-cowork-chat') });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.mcpServers).toEqual(coworkAgent.mcpServers);
  });

  it('[DATA] returns empty object when agent has no bindings', async () => {
    mockAgentGetById.mockResolvedValue({ ...coworkAgent, mcpServers: undefined });

    const req = new NextRequest('http://localhost/api/agents/tealflow-cowork-chat/mcp-servers');
    const res = await GET(req, { params: makeParams('tealflow-cowork-chat') });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.mcpServers).toEqual({});
  });

  it('[ERROR] 404 when agent does not exist', async () => {
    mockAgentGetById.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/agents/unknown/mcp-servers');
    const res = await GET(req, { params: makeParams('unknown') });

    expect(res.status).toBe(404);
  });

  it('[AUTH] returns 404 when user is not a member of the agent namespace', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'outsider',
      namespaces: new Set(['other-ns']),
      namespaceRoles: new Map([['other-ns', 'member']]),
      isSystemActor: false,
    });
    mockAgentGetByIdVisibleTo.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/agents/tealflow-cowork-chat/mcp-servers');
    const res = await GET(req, { params: makeParams('tealflow-cowork-chat') });

    expect(res.status).toBe(404);
  });
});
