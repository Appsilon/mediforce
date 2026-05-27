import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { AgentDefinition } from '@mediforce/platform-core';

const mockAgentGetById = vi.fn();
const mockAgentGetByIdVisibleTo = vi.fn();
const mockAgentUpdate = vi.fn();
const mockAgentDelete = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    agentDefinitionRepo: {
      getById: mockAgentGetById,
      getByIdVisibleTo: mockAgentGetByIdVisibleTo,
      update: mockAgentUpdate,
      delete: mockAgentDelete,
    },
    auditRepo: { append: mockAuditAppend },
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

import { PUT, DELETE } from '../route';

const makeParams = (id: string) => Promise.resolve({ id });

const existing: AgentDefinition = {
  id: 'agent-1',
  kind: 'plugin',
  runtimeId: 'claude-code-agent',
  name: 'Agent One',
  iconName: 'Bot',
  description: '',
  foundationModel: 'anthropic/claude-sonnet-4',
  systemPrompt: '',
  inputDescription: '',
  outputDescription: '',
  skillFileNames: [],
  namespace: 'ns-1',
  visibility: 'private',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function makePutRequest(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/agents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/agents/${id}`, { method: 'DELETE' });
}

describe('PUT /api/agents/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockAgentGetById.mockResolvedValue(existing);
    mockAgentGetByIdVisibleTo.mockResolvedValue(existing);
    mockAgentUpdate.mockResolvedValue({ ...existing, name: 'Agent One Renamed' });
  });

  it('[DATA] updates an agent and emits audit', async () => {
    const res = await PUT(makePutRequest('agent-1', { name: 'Agent One Renamed' }), {
      params: makeParams('agent-1'),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.agent.name).toBe('Agent One Renamed');
    expect(mockAgentUpdate).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ name: 'Agent One Renamed' }),
    );
    expect(mockAuditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent.updated' }),
    );
  });

  it('[AUTHZ] non-member sees 404 (anti-enum) — never reveals the agent exists', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['other-ns']),
      isSystemActor: false,
    });

    const res = await PUT(makePutRequest('agent-1', { name: 'Hijack' }), {
      params: makeParams('agent-1'),
    });

    expect(res.status).toBe(404);
    expect(mockAgentUpdate).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/agents/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockAgentGetById.mockResolvedValue(existing);
    mockAgentGetByIdVisibleTo.mockResolvedValue(existing);
    mockAgentDelete.mockResolvedValue(undefined);
  });

  it('[DATA] deletes an agent and emits audit', async () => {
    const res = await DELETE(makeDeleteRequest('agent-1'), { params: makeParams('agent-1') });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true });
    expect(mockAgentDelete).toHaveBeenCalledWith('agent-1');
    expect(mockAuditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent.deleted' }),
    );
  });

  it('[ERROR] returns 404 when agent does not exist', async () => {
    mockAgentGetById.mockResolvedValue(null);

    const res = await DELETE(makeDeleteRequest('unknown'), { params: makeParams('unknown') });

    expect(res.status).toBe(404);
    expect(mockAgentDelete).not.toHaveBeenCalled();
  });

  it('[AUTHZ] non-member sees 404 (anti-enum) — handler load returns null', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['other-ns']),
      isSystemActor: false,
    });
    // Wrapper's `getByIdVisibleTo` is what the handler hits for non-system
    // actors; outside the caller's namespaces it returns null, surfacing as
    // 404 via `loadOr404` — never reveals existence.
    mockAgentGetByIdVisibleTo.mockResolvedValue(null);

    const res = await DELETE(makeDeleteRequest('agent-1'), { params: makeParams('agent-1') });

    expect(res.status).toBe(404);
    expect(mockAgentDelete).not.toHaveBeenCalled();
  });
});
