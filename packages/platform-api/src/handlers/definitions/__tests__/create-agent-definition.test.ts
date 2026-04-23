import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryAgentDefinitionRepository,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { createAgentDefinition } from '../create-agent-definition.js';
import type { CreateAgentDefinitionInput } from '@mediforce/platform-core';

const BASE_INPUT: CreateAgentDefinitionInput = {
  kind: 'plugin',
  runtimeId: 'claude-code-agent',
  name: 'Supplier risk agent',
  iconName: 'Shield',
  description: 'Assesses supplier risk',
  foundationModel: 'anthropic/claude-sonnet-4',
  systemPrompt: 'You are a risk analyst.',
  inputDescription: 'Supplier snapshot',
  outputDescription: 'Risk verdict',
  skillFileNames: [],
};

describe('createAgentDefinition handler', () => {
  let agentDefinitionRepo: InMemoryAgentDefinitionRepository;

  beforeEach(() => {
    resetFactorySequence();
    agentDefinitionRepo = new InMemoryAgentDefinitionRepository();
  });

  it('persists and returns the newly created agent', async () => {
    const result = await createAgentDefinition(BASE_INPUT, { agentDefinitionRepo });

    expect(result.agent.name).toBe('Supplier risk agent');
    expect(result.agent.id).toBeTruthy();

    const fetched = await agentDefinitionRepo.getById(result.agent.id);
    expect(fetched).not.toBeNull();
  });
});
