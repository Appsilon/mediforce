import { describe, expect, it, vi } from 'vitest';
import type { ModelRegistryRepository, CreateModelRegistryEntryInput, ModelRegistryEntry } from '@mediforce/platform-core';
import { syncModels } from '../sync-models.js';

function stubEntry(): ModelRegistryEntry {
  return { id: 'test/m', name: 'm', provider: 'test', contextLength: 0, maxCompletionTokens: null, pricing: { input: 0, output: 0 }, modality: 'text->text', inputModalities: ['text'], outputModalities: ['text'], supportsTools: false, supportsVision: false, source: 'openrouter' as const, requestCount: null, lastSyncedAt: '', createdAt: '', updatedAt: '' };
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
    getMeta: async () => ({ rankingsUpdatedAt: null }),
  };
}

describe('syncModels handler', () => {
  it('returns synced count and lastSyncedAt from OpenRouter response', async () => {
    const fakeResponse = {
      data: [
        {
          id: 'test/model-1',
          name: 'Test Model 1',
          context_length: 8192,
          architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'] },
          pricing: { prompt: '0.000001', completion: '0.000002' },
          top_provider: { context_length: 8192, max_completion_tokens: null },
          supported_parameters: ['tools'],
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(fakeResponse), { status: 200 }),
    );

    const result = await syncModels({ modelRegistryRepo: makeRepo() });
    expect(result.synced).toBe(1);
    expect(result.total).toBe(1);
    expect(result.lastSyncedAt).toBeTruthy();

    vi.restoreAllMocks();
  });
});
