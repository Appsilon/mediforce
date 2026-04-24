import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryAgentDefinitionRepository } from '@mediforce/platform-core/testing';
import { listAgentDefinitions } from '../list-agent-definitions.js';

function makeInput() {
  return {
    kind: 'plugin' as const,
    runtimeId: 'claude-code-agent',
    name: 'Test Agent',
    iconName: 'robot',
    description: 'An agent for testing',
    foundationModel: 'gpt-4',
    systemPrompt: 'You are a test agent',
    inputDescription: 'text',
    outputDescription: 'json',
    skillFileNames: [],
  };
}

describe('listAgentDefinitions handler', () => {
  let agentDefinitionRepo: InMemoryAgentDefinitionRepository;

  beforeEach(() => {
    agentDefinitionRepo = new InMemoryAgentDefinitionRepository();
  });

  it('returns every agent definition wrapped in { agents }', async () => {
    await agentDefinitionRepo.create({ ...makeInput(), name: 'A' });
    await agentDefinitionRepo.create({ ...makeInput(), name: 'B' });

    const result = await listAgentDefinitions({}, { agentDefinitionRepo });

    expect(result.agents).toHaveLength(2);
    expect(result.agents.map((a) => a.name).sort()).toEqual(['A', 'B']);
  });

  it('returns { agents: [] } when nothing is registered', async () => {
    const result = await listAgentDefinitions({}, { agentDefinitionRepo });
    expect(result.agents).toEqual([]);
  });
});
