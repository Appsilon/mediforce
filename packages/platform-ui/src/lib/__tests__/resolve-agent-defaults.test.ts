import { describe, it, expect, vi } from 'vitest';
import type { AgentDefinition, AgentDefinitionRepository } from '@mediforce/platform-core';

import { resolveAgentDefaults } from '../resolve-agent-defaults';

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

describe('resolveAgentDefaults', () => {
  it('returns no identity prompt when agent not found', async () => {
    const repo = makeRepo(null);
    const result = await resolveAgentDefaults('missing', repo);
    expect(result.identityPrompt).toBeUndefined();
  });

  it('returns no identity prompt when agent has no systemPrompt', async () => {
    const repo = makeRepo(makeAgent({ systemPrompt: '' }));
    const result = await resolveAgentDefaults('agent-1', repo);
    expect(result.identityPrompt).toBeUndefined();
  });

  it('returns the systemPrompt under an Agent Identity heading', async () => {
    const repo = makeRepo(makeAgent({ systemPrompt: 'You are a CDISC expert.' }));
    const result = await resolveAgentDefaults('agent-1', repo);
    expect(result.identityPrompt).toContain('## Agent Identity');
    expect(result.identityPrompt).toContain('You are a CDISC expert.');
  });

  it('never emits a Skills heading', async () => {
    const repo = makeRepo(makeAgent({ systemPrompt: 'You author CDISC rules.' }));
    const result = await resolveAgentDefaults('agent-1', repo);
    expect(result.identityPrompt).not.toContain('## Skills');
  });

  it('returns the agent foundationModel as the model', async () => {
    const repo = makeRepo(makeAgent({ foundationModel: 'anthropic/claude-opus-4' }));
    const result = await resolveAgentDefaults('agent-1', repo);
    expect(result.model).toBe('anthropic/claude-opus-4');
  });

  it('returns the model even when the agent has no systemPrompt', async () => {
    const repo = makeRepo(makeAgent({ systemPrompt: '', foundationModel: 'openai/gpt-5' }));
    const result = await resolveAgentDefaults('agent-1', repo);
    expect(result.identityPrompt).toBeUndefined();
    expect(result.model).toBe('openai/gpt-5');
  });

  it('returns no model when the agent is not found', async () => {
    const repo = makeRepo(null);
    const result = await resolveAgentDefaults('missing', repo);
    expect(result.model).toBeUndefined();
  });

  it('returns no model when the agent foundationModel is blank', async () => {
    const repo = makeRepo(makeAgent({ foundationModel: '' }));
    const result = await resolveAgentDefaults('agent-1', repo);
    expect(result.model).toBeUndefined();
  });
});
