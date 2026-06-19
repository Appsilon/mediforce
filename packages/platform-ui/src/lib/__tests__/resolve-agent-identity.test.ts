import { describe, it, expect, vi } from 'vitest';
import type { AgentDefinition, AgentDefinitionRepository } from '@mediforce/platform-core';

import { resolveAgentIdentity } from '../resolve-agent-identity';

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    iconName: 'Bot',
    description: 'test',
    foundationModel: 'anthropic/claude-sonnet-4',
    systemPrompt: '',
    inputDescription: '',
    outputDescription: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeRepo(agent: AgentDefinition | null): AgentDefinitionRepository {
  return {
    getById: vi.fn().mockResolvedValue(agent),
    create: vi.fn(),
    upsert: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

describe('resolveAgentIdentity', () => {
  it('returns undefined when agent not found', async () => {
    const repo = makeRepo(null);
    const result = await resolveAgentIdentity('missing', repo);
    expect(result).toBeUndefined();
  });

  it('returns undefined when agent has no systemPrompt', async () => {
    const repo = makeRepo(makeAgent({ systemPrompt: '' }));
    const result = await resolveAgentIdentity('agent-1', repo);
    expect(result).toBeUndefined();
  });

  it('returns the systemPrompt under an Agent Identity heading', async () => {
    const repo = makeRepo(makeAgent({ systemPrompt: 'You are a CDISC expert.' }));
    const result = await resolveAgentIdentity('agent-1', repo);
    expect(result).toContain('## Agent Identity');
    expect(result).toContain('You are a CDISC expert.');
  });

  it('never emits a Skills heading', async () => {
    const repo = makeRepo(makeAgent({ systemPrompt: 'You author CDISC rules.' }));
    const result = await resolveAgentIdentity('agent-1', repo);
    expect(result).not.toContain('## Skills');
  });
});
