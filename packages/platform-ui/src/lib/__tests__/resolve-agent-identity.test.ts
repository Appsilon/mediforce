import { describe, it, expect, vi } from 'vitest';
import type { AgentDefinition, AgentDefinitionRepository } from '@mediforce/platform-core';

import {
  resolveAgentIdentity,
  resolveAgentIdentityPrompt,
} from '../resolve-agent-identity';

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'agent-1',
    kind: 'plugin',
    name: 'Test Agent',
    iconName: 'Bot',
    description: 'test',
    foundationModel: 'anthropic/claude-sonnet-4',
    systemPrompt: '',
    inputDescription: '',
    outputDescription: '',
    skills: [],
    visibility: 'private',
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
    expect(result.prompt).toBeUndefined();
  });

  it('returns undefined when agent has no systemPrompt', async () => {
    const repo = makeRepo(makeAgent({ systemPrompt: '' }));
    const result = await resolveAgentIdentity('agent-1', repo);
    expect(result.prompt).toBeUndefined();
  });

  it('returns systemPrompt wrapped in `## Agent Identity` block', async () => {
    const repo = makeRepo(makeAgent({ systemPrompt: 'You are a CDISC expert.' }));
    const result = await resolveAgentIdentity('agent-1', repo);
    expect(result.prompt).toContain('## Agent Identity');
    expect(result.prompt).toContain('You are a CDISC expert.');
    expect(result.prompt).not.toContain('## Skills');
  });

  it('resolveAgentIdentityPrompt returns just the prompt string', async () => {
    const repo = makeRepo(makeAgent({ systemPrompt: 'Hello' }));
    const prompt = await resolveAgentIdentityPrompt('agent-1', repo);
    expect(prompt).toContain('Hello');
  });
});
