import { describe, expect, it, vi } from 'vitest';
import type {
  ModelRegistryRepository,
  CreateModelRegistryEntryInput,
  ModelRegistryEntry,
} from '@mediforce/platform-core';
import { syncWithRetry } from '../openrouter-sync';

function stubEntry(): ModelRegistryEntry {
  return {
    id: 'test/m',
    name: 'm',
    provider: 'test',
    contextLength: 0,
    maxCompletionTokens: null,
    pricing: { input: 0, output: 0 },
    modality: 'text->text',
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsTools: false,
    supportsVision: false,
    source: 'openrouter' as const,
    canonicalSlug: null,
    requestCount: null,
    lastSyncedAt: '',
    createdAt: '',
    updatedAt: '',
    retiredAt: null,
  };
}

function makeRepo(overrides: Partial<ModelRegistryRepository> = {}): ModelRegistryRepository {
  return {
    list: async () => [],
    getById: async () => null,
    upsert: async (_input: CreateModelRegistryEntryInput) => stubEntry(),
    update: async () => stubEntry(),
    delete: async () => {},
    bulkUpsert: async (items: CreateModelRegistryEntryInput[]) => items.length,
    updateRankings: async (rankings) => rankings.length,
    getMeta: async () => ({ rankingsUpdatedAt: null }),
    listIds: async () => [],
    retireAbsentModels: async () => ({ retired: 0, reinstated: 0 }),
    ...overrides,
  };
}

function makeFakeModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test/model-1',
    name: 'Test Model 1',
    context_length: 8192,
    architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'] },
    pricing: { prompt: '0.000001', completion: '0.000002' },
    top_provider: { context_length: 8192, max_completion_tokens: null },
    supported_parameters: ['tools'],
    ...overrides,
  };
}

describe('syncWithRetry', () => {
  it('succeeds on first attempt', async () => {
    const fakeResponse = { data: [makeFakeModel()] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(fakeResponse), { status: 200 }));
    const result = await syncWithRetry(makeRepo(), { maxRetries: 3, intervalMs: 10 });
    expect(result.synced).toBe(1);
    vi.restoreAllMocks();
  });

  it('retries after failure and succeeds on third attempt', async () => {
    const fakeResponse = { data: [makeFakeModel()] };
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network error 1'))
      .mockRejectedValueOnce(new Error('network error 2'))
      .mockResolvedValueOnce(new Response(JSON.stringify(fakeResponse), { status: 200 }));

    const result = await syncWithRetry(makeRepo(), { maxRetries: 3, intervalMs: 10 });
    expect(result.synced).toBe(1);
    vi.restoreAllMocks();
  });

  it('throws after exhausting all retries', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('always fails'));
    await expect(syncWithRetry(makeRepo(), { maxRetries: 2, intervalMs: 10 })).rejects.toThrow('always fails');
    vi.restoreAllMocks();
  });
});
