import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryAgentDefinitionRepository } from '@mediforce/platform-core/testing';
import { getAgentDefinition } from '../get-agent-definition.js';
import { NotFoundError } from '../../../errors.js';

const baseInput = {
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

describe('getAgentDefinition handler', () => {
  let agentDefinitionRepo: InMemoryAgentDefinitionRepository;

  beforeEach(() => {
    agentDefinitionRepo = new InMemoryAgentDefinitionRepository();
  });

  it('returns the agent wrapped in { agent } when it exists', async () => {
    const created = await agentDefinitionRepo.upsert('agent-42', baseInput);

    const result = await getAgentDefinition({ id: 'agent-42' }, { agentDefinitionRepo });

    expect(result.agent.id).toBe('agent-42');
    expect(result.agent.name).toBe(created.name);
  });

  it('throws NotFoundError when the id is unknown', async () => {
    await expect(
      getAgentDefinition({ id: 'missing' }, { agentDefinitionRepo }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
