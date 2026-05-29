import { describe, expect, it } from 'vitest';
import type { ModelRegistryEntry, ModelRegistryRepository, CreateModelRegistryEntryInput } from '@mediforce/platform-core';
import { getModel } from '../get-model';

function makeEntry(id: string): ModelRegistryEntry {
  return {
    id,
    name: id,
    provider: id.split('/')[0],
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
    createdAt: '2026-05-04T00:00:00Z',
    updatedAt: '2026-05-04T00:00:00Z',
  };
}

function makeRepo(entries: ModelRegistryEntry[]): ModelRegistryRepository {
  return {
    list: async () => entries,
    getById: async (id) => entries.find((e) => e.id === id) ?? null,
    upsert: async (input: CreateModelRegistryEntryInput) => makeEntry(input.id),
    update: async () => entries[0],
    delete: async () => {},
    bulkUpsert: async (items: CreateModelRegistryEntryInput[]) => items.length,
    updateRankings: async (rankings) => rankings.length,
    getMeta: async () => ({ rankingsUpdatedAt: null }),
  };
}

describe('getModel handler', () => {
  const entries = [makeEntry('anthropic/claude-sonnet-4')];

  it('returns model by id', async () => {
    const result = await getModel({ id: 'anthropic/claude-sonnet-4' }, { modelRegistryRepo: makeRepo(entries) });
    expect(result.model.id).toBe('anthropic/claude-sonnet-4');
  });

  it('throws when model not found', async () => {
    await expect(
      getModel({ id: 'nonexistent/model' }, { modelRegistryRepo: makeRepo(entries) }),
    ).rejects.toThrow("Model 'nonexistent/model' not found");
  });
});
