import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAgentGetById = vi.fn();
const mockAgentUpdate = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    agentDefinitionRepo: {
      getById: mockAgentGetById,
      update: mockAgentUpdate,
    },
  }),
}));

import { PUT, DELETE } from '../route';

const makeParams = (id: string, name: string) => Promise.resolve({ id, name });

function makePutRequest(id: string, name: string, body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/agent-definitions/${id}/mcp-servers/${name}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

function makeDeleteRequest(id: string, name: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/agent-definitions/${id}/mcp-servers/${name}`,
    { method: 'DELETE' },
  );
}

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
    existing: { type: 'stdio' as const, catalogId: 'existing-mcp' },
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const pluginAgent = {
  ...coworkAgent,
  id: 'claude-code-agent',
  kind: 'plugin' as const,
  mcpServers: undefined,
};

const stdioBinding = { type: 'stdio', catalogId: 'new-mcp' };
const httpBinding = { type: 'http', url: 'https://mcp.example.com/server' };

// ---- PUT ----

describe('PUT /api/agent-definitions/:id/mcp-servers/:name', () => {
  beforeEach(() => vi.clearAllMocks());

  it('[DATA] creates a new stdio binding', async () => {
    mockAgentGetById.mockResolvedValue(coworkAgent);
    mockAgentUpdate.mockImplementation((_id: string, patch: { mcpServers?: unknown }) =>
      Promise.resolve({ ...coworkAgent, mcpServers: patch.mcpServers }),
    );

    const res = await PUT(
      makePutRequest('tealflow-cowork-chat', 'new', stdioBinding),
      { params: makeParams('tealflow-cowork-chat', 'new') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.mcpServers).toEqual({
      existing: coworkAgent.mcpServers.existing,
      new: stdioBinding,
    });
    expect(mockAgentUpdate).toHaveBeenCalledWith('tealflow-cowork-chat', {
      mcpServers: { existing: coworkAgent.mcpServers.existing, new: stdioBinding },
    });
  });

  it('[DATA] creates an http binding', async () => {
    mockAgentGetById.mockResolvedValue(coworkAgent);
    mockAgentUpdate.mockImplementation((_id: string, patch: { mcpServers?: unknown }) =>
      Promise.resolve({ ...coworkAgent, mcpServers: patch.mcpServers }),
    );

    const res = await PUT(
      makePutRequest('tealflow-cowork-chat', 'remote', httpBinding),
      { params: makeParams('tealflow-cowork-chat', 'remote') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.mcpServers.remote).toEqual(httpBinding);
  });

  it('[DATA] replaces an existing binding', async () => {
    mockAgentGetById.mockResolvedValue(coworkAgent);
    mockAgentUpdate.mockImplementation((_id: string, patch: { mcpServers?: unknown }) =>
      Promise.resolve({ ...coworkAgent, mcpServers: patch.mcpServers }),
    );

    const replacement = { type: 'http', url: 'https://other.example.com' };
    const res = await PUT(
      makePutRequest('tealflow-cowork-chat', 'existing', replacement),
      { params: makeParams('tealflow-cowork-chat', 'existing') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.mcpServers.existing).toEqual(replacement);
  });

  it('[ERROR] 400 on schema validation failure (missing type)', async () => {
    mockAgentGetById.mockResolvedValue(coworkAgent);

    const res = await PUT(
      makePutRequest('tealflow-cowork-chat', 'bad', { catalogId: 'x' }),
      { params: makeParams('tealflow-cowork-chat', 'bad') },
    );
    expect(res.status).toBe(400);
    expect(mockAgentUpdate).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 when stdio binding carries inline command (strict)', async () => {
    mockAgentGetById.mockResolvedValue(coworkAgent);

    // Reject inline command — the whole point of the refactor is closing
    // this path so RCE stays off the table.
    const res = await PUT(
      makePutRequest('tealflow-cowork-chat', 'evil', {
        type: 'stdio',
        catalogId: 'x',
        command: 'rm -rf /',
      }),
      { params: makeParams('tealflow-cowork-chat', 'evil') },
    );
    expect(res.status).toBe(400);
    expect(mockAgentUpdate).not.toHaveBeenCalled();
  });

  it('[ERROR] 404 when agent does not exist', async () => {
    mockAgentGetById.mockResolvedValue(null);

    const res = await PUT(
      makePutRequest('unknown', 'x', stdioBinding),
      { params: makeParams('unknown', 'x') },
    );
    expect(res.status).toBe(404);
  });

  it('[DATA] creates a binding on a plugin agent (gate removed — J1)', async () => {
    // Plugin agents (e.g. claude-code-agent, opencode-agent) can carry MCP
    // bindings. Schema + writeMcpConfig are kind-agnostic; the old API-level
    // gate was the only blocker. Use case: autonomous docker agent scoped to
    // read-only tool restrictions via AgentMcpBinding.allowedTools.
    mockAgentGetById.mockResolvedValue(pluginAgent);
    mockAgentUpdate.mockImplementation((_id: string, patch: { mcpServers?: unknown }) =>
      Promise.resolve({ ...pluginAgent, mcpServers: patch.mcpServers }),
    );

    const res = await PUT(
      makePutRequest('claude-code-agent', 'readonly-docs', stdioBinding),
      { params: makeParams('claude-code-agent', 'readonly-docs') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.mcpServers).toEqual({ 'readonly-docs': stdioBinding });
    expect(mockAgentUpdate).toHaveBeenCalledWith('claude-code-agent', {
      mcpServers: { 'readonly-docs': stdioBinding },
    });
  });
});

// ---- DELETE ----

describe('DELETE /api/agent-definitions/:id/mcp-servers/:name', () => {
  beforeEach(() => vi.clearAllMocks());

  it('[DATA] removes an existing binding', async () => {
    mockAgentGetById.mockResolvedValue(coworkAgent);
    mockAgentUpdate.mockImplementation((_id: string, patch: { mcpServers?: unknown }) =>
      Promise.resolve({ ...coworkAgent, mcpServers: patch.mcpServers }),
    );

    const res = await DELETE(
      makeDeleteRequest('tealflow-cowork-chat', 'existing'),
      { params: makeParams('tealflow-cowork-chat', 'existing') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.mcpServers).toEqual({});
    expect(mockAgentUpdate).toHaveBeenCalledWith('tealflow-cowork-chat', { mcpServers: {} });
  });

  it('[ERROR] 404 when agent does not exist', async () => {
    mockAgentGetById.mockResolvedValue(null);

    const res = await DELETE(
      makeDeleteRequest('unknown', 'x'),
      { params: makeParams('unknown', 'x') },
    );
    expect(res.status).toBe(404);
  });

  it('[DATA] removes a binding on a plugin agent (gate removed — J1)', async () => {
    const pluginWithBinding = {
      ...pluginAgent,
      mcpServers: { 'readonly-docs': { type: 'stdio' as const, catalogId: 'docs' } },
    };
    mockAgentGetById.mockResolvedValue(pluginWithBinding);
    mockAgentUpdate.mockImplementation((_id: string, patch: { mcpServers?: unknown }) =>
      Promise.resolve({ ...pluginWithBinding, mcpServers: patch.mcpServers }),
    );

    const res = await DELETE(
      makeDeleteRequest('claude-code-agent', 'readonly-docs'),
      { params: makeParams('claude-code-agent', 'readonly-docs') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.mcpServers).toEqual({});
  });

  it('[DATA] idempotent — 200 with unchanged bindings when name does not exist', async () => {
    mockAgentGetById.mockResolvedValue(coworkAgent);
    mockAgentUpdate.mockImplementation((_id: string, patch: { mcpServers?: unknown }) =>
      Promise.resolve({ ...coworkAgent, mcpServers: patch.mcpServers }),
    );

    const res = await DELETE(
      makeDeleteRequest('tealflow-cowork-chat', 'missing'),
      { params: makeParams('tealflow-cowork-chat', 'missing') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.mcpServers).toEqual(coworkAgent.mcpServers);
    expect(mockAgentUpdate).toHaveBeenCalledWith('tealflow-cowork-chat', {
      mcpServers: coworkAgent.mcpServers,
    });
  });
});
