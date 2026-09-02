import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InMemoryModelRegistryRepository } from '@mediforce/platform-core/testing';
import { syncRegistryIfStale } from '../sync-if-stale';

const OPENROUTER_MODELS = [
  {
    id: 'test/model-a',
    name: 'Model A',
    context_length: 4096,
    architecture: {
      modality: 'text->text',
      input_modalities: ['text'],
      output_modalities: ['text'],
    },
    pricing: { prompt: '0.0001', completion: '0.0002' },
    top_provider: { context_length: 4096, max_completion_tokens: null },
    supported_parameters: [],
  },
];

function mockFetchSuccess() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const data = String(input).includes('/rankings/') ? [] : OPENROUTER_MODELS;
    return { ok: true, json: async () => ({ data }) } as Response;
  });
}

function mockFetchFailure() {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
}

describe('syncRegistryIfStale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips sync when registry is fresh', async () => {
    const repo = new InMemoryModelRegistryRepository();
    const recentTs = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago
    await repo.upsert({
      id: 'test/model-a',
      canonicalSlug: null,
      name: 'Model A',
      provider: 'test',
      contextLength: 4096,
      maxCompletionTokens: null,
      pricing: { input: 0, output: 0 },
      modality: 'text->text',
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsTools: false,
      supportsVision: false,
      source: 'openrouter' as const,
      requestCount: null,
      lastSyncedAt: recentTs,
      retiredAt: null,
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const outcome = await syncRegistryIfStale(repo);

    expect(outcome.ran).toBe(false);
    expect(outcome.result).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('runs sync when registry is empty (stale)', async () => {
    const repo = new InMemoryModelRegistryRepository();
    mockFetchSuccess();

    const outcome = await syncRegistryIfStale(repo);

    expect(outcome.ran).toBe(true);
    expect(outcome.result).toBeDefined();
    expect(outcome.result?.synced).toBe(1);
    expect(outcome.error).toBeUndefined();
  });

  it('runs sync when registry is older than 24h', async () => {
    const repo = new InMemoryModelRegistryRepository();
    const oldTs = new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(); // 25 hours ago
    await repo.upsert({
      id: 'test/model-a',
      canonicalSlug: null,
      name: 'Model A',
      provider: 'test',
      contextLength: 4096,
      maxCompletionTokens: null,
      pricing: { input: 0, output: 0 },
      modality: 'text->text',
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsTools: false,
      supportsVision: false,
      source: 'openrouter' as const,
      requestCount: null,
      lastSyncedAt: oldTs,
      retiredAt: null,
    });
    mockFetchSuccess();

    const outcome = await syncRegistryIfStale(repo);

    expect(outcome.ran).toBe(true);
    expect(outcome.result).toBeDefined();
    expect(outcome.error).toBeUndefined();
  });

  it('returns error (does not throw) when sync fails', async () => {
    const repo = new InMemoryModelRegistryRepository();
    mockFetchFailure();

    const outcome = await syncRegistryIfStale(repo);

    expect(outcome.ran).toBe(true);
    expect(outcome.error).toBe('Network error');
    expect(outcome.result).toBeUndefined();
  });
});
