import { describe, expect, it } from 'vitest';
import type { ModelRegistryEntry, ModelRegistryRepository, CreateModelRegistryEntryInput } from '@mediforce/platform-core';
import { listModels } from '../list-models.js';

function makeEntry(overrides: Partial<ModelRegistryEntry> & { id: string }): ModelRegistryEntry {
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
    requestCount: null,
    lastSyncedAt: '2026-05-04T00:00:00Z',
    createdAt: '2026-05-04T00:00:00Z',
    updatedAt: '2026-05-04T00:00:00Z',
    ...overrides,
  };
}

function makeRepo(entries: ModelRegistryEntry[]): ModelRegistryRepository {
  return {
    list: async () => entries,
    getById: async (id) => entries.find((e) => e.id === id) ?? null,
    upsert: async (input: CreateModelRegistryEntryInput) => makeEntry(input as ModelRegistryEntry),
    update: async () => entries[0],
    delete: async () => {},
    bulkUpsert: async (items: CreateModelRegistryEntryInput[]) => items.length,
    updateRankings: async (rankings) => rankings.length,
    getMeta: async () => ({ rankingsUpdatedAt: null }),
  };
}

describe('listModels handler', () => {
  const entries = [
    makeEntry({ id: 'anthropic/claude-sonnet-4', contextLength: 200000, supportsVision: true }),
    makeEntry({ id: 'deepseek/deepseek-chat', provider: 'deepseek', contextLength: 64000, supportsTools: false }),
    makeEntry({ id: 'openai/gpt-4o', provider: 'openai', supportsVision: true }),
  ];

  it('returns all models when no filters given', async () => {
    const result = await listModels(undefined, { modelRegistryRepo: makeRepo(entries) });
    expect(result.models).toHaveLength(3);
  });

  it('filters by provider', async () => {
    const result = await listModels({ provider: 'deepseek' }, { modelRegistryRepo: makeRepo(entries) });
    expect(result.models).toHaveLength(1);
    expect(result.models[0].id).toBe('deepseek/deepseek-chat');
  });

  it('filters by supportsTools', async () => {
    const result = await listModels({ supportsTools: false }, { modelRegistryRepo: makeRepo(entries) });
    expect(result.models).toHaveLength(1);
    expect(result.models[0].id).toBe('deepseek/deepseek-chat');
  });

  it('filters by supportsVision', async () => {
    const result = await listModels({ supportsVision: true }, { modelRegistryRepo: makeRepo(entries) });
    expect(result.models).toHaveLength(2);
  });

  it('filters by minContextLength', async () => {
    const result = await listModels({ minContextLength: 100000 }, { modelRegistryRepo: makeRepo(entries) });
    expect(result.models).toHaveLength(2);
  });

  it('sorts by provider then name', async () => {
    const result = await listModels(undefined, { modelRegistryRepo: makeRepo(entries) });
    expect(result.models.map((m) => m.provider)).toEqual(['anthropic', 'deepseek', 'openai']);
  });
});
