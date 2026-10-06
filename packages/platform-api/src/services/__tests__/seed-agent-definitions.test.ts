import { describe, expect, it } from 'vitest';
import {
  InMemoryAgentDefinitionRepository,
  InMemoryModelRegistryRepository,
} from '@mediforce/platform-core/testing';
import { DEFAULT_MODEL, type CreateModelRegistryEntryInput } from '@mediforce/platform-core';
import { seedBuiltinAgentDefinitions } from '../seed-agent-definitions';

function makeEntry(id: string): CreateModelRegistryEntryInput {
  return {
    id,
    name: id,
    provider: id.split('/')[0],
    contextLength: 200000,
    maxCompletionTokens: null,
    pricing: { input: 0.000003, output: 0.000015 },
    modality: 'text->text',
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsTools: true,
    supportsVision: false,
    source: 'openrouter',
    canonicalSlug: null,
    requestCount: null,
    lastSyncedAt: '2026-10-06T00:00:00Z',
    retiredAt: null,
  };
}

describe('seedBuiltinAgentDefinitions', () => {
  it('[DATA] pins a seed on the default model to the newest Sonnet the registry lists, leaving explicit models alone', async () => {
    const agents = new InMemoryAgentDefinitionRepository();
    const models = new InMemoryModelRegistryRepository();
    await models.bulkUpsert([makeEntry(DEFAULT_MODEL), makeEntry('anthropic/claude-sonnet-5'), makeEntry('anthropic/claude-sonnet-5.5')]);

    await seedBuiltinAgentDefinitions(agents, models);

    expect((await agents.getById('claude-code-agent'))?.foundationModel).toBe('anthropic/claude-sonnet-5.5');
    expect((await agents.getById('opencode-agent'))?.foundationModel).toBe('deepseek/deepseek-chat');
  });

  it('[DATA] keeps the alias when the registry has not synced yet', async () => {
    const agents = new InMemoryAgentDefinitionRepository();

    await seedBuiltinAgentDefinitions(agents, new InMemoryModelRegistryRepository());

    expect((await agents.getById('claude-code-agent'))?.foundationModel).toBe(DEFAULT_MODEL);
  });
});
