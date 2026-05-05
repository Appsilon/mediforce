import { describe, expect, it } from 'vitest';
import type { ModelRegistryRepository, CreateModelRegistryEntryInput, ModelRegistryEntry } from '@mediforce/platform-core';
import { updateRankings } from '../update-rankings.js';

function stubEntry(): ModelRegistryEntry {
  return { id: 'test/m', name: 'm', provider: 'test', contextLength: 0, maxCompletionTokens: null, pricing: { input: 0, output: 0 }, modality: 'text->text', inputModalities: ['text'], outputModalities: ['text'], supportsTools: false, supportsVision: false, source: 'openrouter' as const, canonicalSlug: null, requestCount: null, lastSyncedAt: '', createdAt: '', updatedAt: '' };
}

function makeRepo(): ModelRegistryRepository {
  return {
    list: async () => [],
    getById: async () => null,
    upsert: async (_input: CreateModelRegistryEntryInput) => stubEntry(),
    update: async () => stubEntry(),
    delete: async () => {},
    bulkUpsert: async (items: CreateModelRegistryEntryInput[]) => items.length,
    updateRankings: async (rankings) => rankings.length,
    getMeta: async () => ({ rankingsUpdatedAt: '2026-05-05T00:00:00Z' }),
  };
}

describe('updateRankings handler', () => {
  it('returns updated count and timestamp', async () => {
    const result = await updateRankings(
      { rankings: [{ id: 'test/model', requestCount: 1000 }] },
      { modelRegistryRepo: makeRepo() },
    );
    expect(result.updated).toBe(1);
    expect(result.rankingsUpdatedAt).toBe('2026-05-05T00:00:00Z');
  });
});
