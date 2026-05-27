import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { AgentDefinition } from '@mediforce/platform-core';

const mockAgentCreate = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    agentDefinitionRepo: { create: mockAgentCreate },
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

import { POST } from '../route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  kind: 'plugin' as const,
  runtimeId: 'claude-code-agent',
  name: 'My Agent',
  iconName: 'Bot',
  description: '',
  foundationModel: 'anthropic/claude-sonnet-4',
  systemPrompt: '',
  inputDescription: '',
  outputDescription: '',
  skillFileNames: [],
  namespace: 'ns-1',
  visibility: 'private' as const,
};

const persistedAgent: AgentDefinition = {
  id: 'agent-1',
  ...validBody,
  createdAt: '2026-05-27T00:00:00Z',
  updatedAt: '2026-05-27T00:00:00Z',
};

describe('POST /api/agents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockAgentCreate.mockResolvedValue(persistedAgent);
  });

  it('[DATA] creates an agent and emits audit', async () => {
    const res = await POST(makeRequest(validBody), {});
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.agent.id).toBe('agent-1');
    expect(json.agent.name).toBe('My Agent');
    expect(mockAgentCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Agent' }));
    expect(mockAuditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent.created', entityId: 'agent-1' }),
    );
  });

  it('[AUTHZ] returns 403 when caller lacks namespace membership', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['other-ns']),
      isSystemActor: false,
    });

    const res = await POST(makeRequest(validBody), {});

    expect(res.status).toBe(403);
    expect(mockAgentCreate).not.toHaveBeenCalled();
  });

  it('[ERROR] returns 400 when body is missing required fields', async () => {
    const res = await POST(makeRequest({ kind: 'plugin' }), {});
    expect(res.status).toBe(400);
    expect(mockAgentCreate).not.toHaveBeenCalled();
  });
});
