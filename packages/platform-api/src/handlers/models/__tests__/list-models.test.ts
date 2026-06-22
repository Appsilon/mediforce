import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryModelRegistryRepository } from '@mediforce/platform-core/testing';
import type { CreateModelRegistryEntryInput } from '@mediforce/platform-core';
import { listModels } from '../list-models';

function makeEntry(overrides: Partial<CreateModelRegistryEntryInput> & { id: string }): CreateModelRegistryEntryInput {
  return {
    name: overrides.id,
    provider: overrides.id.split('/')[0],
    contextLength: 128000,
    maxCompletionTokens: null,
    pricing: { input: 0.000003, output: 0.000015 },
    modality: 'text->text',
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsTools: true,
    supportsVision: false,
    source: 'openrouter' as const,
    canonicalSlug: null,
    requestCount: null,
    lastSyncedAt: '2026-05-04T00:00:00Z',
    retiredAt: null,
    ...overrides,
  };
}

describe('listModels handler', () => {
  let repo: InMemoryModelRegistryRepository;

  beforeEach(async () => {
    repo = new InMemoryModelRegistryRepository();
    await repo.upsert(makeEntry({ id: 'anthropic/claude-sonnet-4', contextLength: 200000, supportsVision: true }));
    await repo.upsert(
      makeEntry({ id: 'deepseek/deepseek-chat', provider: 'deepseek', contextLength: 64000, supportsTools: false }),
    );
    await repo.upsert(makeEntry({ id: 'openai/gpt-4o', provider: 'openai', supportsVision: true }));
  });

  it('returns all models when no filters given', async () => {
    const result = await listModels(undefined, { modelRegistryRepo: repo });
    expect(result.models).toHaveLength(3);
  });

  it('filters by provider', async () => {
    const result = await listModels({ provider: 'deepseek' }, { modelRegistryRepo: repo });
    expect(result.models).toHaveLength(1);
    expect(result.models[0].id).toBe('deepseek/deepseek-chat');
  });

  it('filters by supportsTools', async () => {
    const result = await listModels({ supportsTools: false }, { modelRegistryRepo: repo });
    expect(result.models).toHaveLength(1);
    expect(result.models[0].id).toBe('deepseek/deepseek-chat');
  });

  it('filters by supportsVision', async () => {
    const result = await listModels({ supportsVision: true }, { modelRegistryRepo: repo });
    expect(result.models).toHaveLength(2);
  });

  it('filters by minContextLength', async () => {
    const result = await listModels({ minContextLength: 100000 }, { modelRegistryRepo: repo });
    expect(result.models).toHaveLength(2);
  });

  it('sorts by provider then name', async () => {
    const result = await listModels(undefined, { modelRegistryRepo: repo });
    expect(result.models.map((m) => m.provider)).toEqual(['anthropic', 'deepseek', 'openai']);
  });
});
