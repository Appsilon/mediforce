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

  it('assigns a unique id to each created agent', async () => {
    const first = await createAgentDefinition(BASE_INPUT, { agentDefinitionRepo });
    const second = await createAgentDefinition(
      { ...BASE_INPUT, name: 'Other agent' },
      { agentDefinitionRepo },
    );

    expect(first.agent.id).not.toBe(second.agent.id);
  });

  it('echoes the cowork kind when supplied', async () => {
    const result = await createAgentDefinition(
      { ...BASE_INPUT, kind: 'cowork', runtimeId: 'chat' },
      { agentDefinitionRepo },
    );

    expect(result.agent.kind).toBe('cowork');
    expect(result.agent.runtimeId).toBe('chat');
  });

  it('propagates repository errors instead of swallowing them', async () => {
    const failingRepo: typeof agentDefinitionRepo = Object.create(agentDefinitionRepo);
    failingRepo.create = async () => {
      throw new Error('firestore unavailable');
    };

    await expect(
      createAgentDefinition(BASE_INPUT, { agentDefinitionRepo: failingRepo }),
    ).rejects.toThrow('firestore unavailable');
  });
});
