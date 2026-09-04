import { describe, expect, it, vi, afterEach } from 'vitest';
import type { ModelRegistryRepository, CreateModelRegistryEntryInput, ModelRegistryEntry } from '@mediforce/platform-core';
import { syncFromOpenRouter } from '../openrouter-sync';

function stubEntry(): ModelRegistryEntry {
  return { id: 'test/m', name: 'm', provider: 'test', contextLength: 0, maxCompletionTokens: null, pricing: { input: 0, output: 0 }, modality: 'text->text', inputModalities: ['text'], outputModalities: ['text'], supportsTools: false, supportsVision: false, source: 'openrouter' as const, canonicalSlug: null, requestCount: null, lastSyncedAt: '', createdAt: '', updatedAt: '', retiredAt: null };
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

/** Stub both OpenRouter feeds: the public model catalogue and the rankings feed. */
function stubOpenRouter(opts: {
  models?: unknown[];
  rankings?: unknown[] | 'fail';
}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/rankings/')) {
      if (opts.rankings === 'fail') return new Response('nope', { status: 503, statusText: 'Service Unavailable' });
      return new Response(JSON.stringify({ data: opts.rankings ?? [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: opts.models ?? [] }), { status: 200 });
  });
}

describe('syncFromOpenRouter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes request counts from the rankings feed, which the model catalogue does not carry', async () => {
    stubOpenRouter({
      models: [makeFakeModel()],
      rankings: [{ id: 'test/model-1', request_count: 500 }],
    });
    const written: Array<{ id: string; requestCount: number }> = [];

    const result = await syncFromOpenRouter(
      makeRepo({
        updateRankings: async (rankings) => {
          written.push(...rankings);
          return rankings.length;
        },
      }),
    );

    expect(written).toEqual([{ id: 'test/model-1', requestCount: 500 }]);
    expect(result.rankingsUpdated).toBe(1);
  });

  it('skips rankings rows without a numeric request count', async () => {
    stubOpenRouter({
      models: [makeFakeModel()],
      rankings: [
        { id: 'test/model-1', request_count: 500 },
        { id: 'test/model-2', request_count: null },
        { request_count: 12 },
      ],
    });
    const written: Array<{ id: string; requestCount: number }> = [];

    await syncFromOpenRouter(
      makeRepo({
        updateRankings: async (rankings) => {
          written.push(...rankings);
          return rankings.length;
        },
      }),
    );

    expect(written).toEqual([{ id: 'test/model-1', requestCount: 500 }]);
  });

  it('still syncs models when the rankings feed fails', async () => {
    stubOpenRouter({ models: [makeFakeModel()], rankings: 'fail' });

    const result = await syncFromOpenRouter(makeRepo());

    expect(result.synced).toBe(1);
    expect(result.rankingsUpdated).toBe(0);
  });
});
