import { describe, expect, it } from 'vitest';
import { InMemoryModelRegistryRepository } from '@mediforce/platform-core/testing';
import { getModel } from '../get-model';

describe('getModel handler', () => {
  it('returns model by id', async () => {
    const repo = new InMemoryModelRegistryRepository();
    await repo.upsert({
      id: 'anthropic/claude-sonnet-4',
      name: 'anthropic/claude-sonnet-4',
      provider: 'anthropic',
      contextLength: 128000,
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
      lastSyncedAt: '2026-05-04T00:00:00Z',
      retiredAt: null,
    });

    const result = await getModel({ id: 'anthropic/claude-sonnet-4' }, { modelRegistryRepo: repo });
    expect(result.model.id).toBe('anthropic/claude-sonnet-4');
  });

  it('throws when model not found', async () => {
    const repo = new InMemoryModelRegistryRepository();
    await repo.upsert({
      id: 'anthropic/claude-sonnet-4',
      name: 'anthropic/claude-sonnet-4',
      provider: 'anthropic',
      contextLength: 128000,
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
      lastSyncedAt: '2026-05-04T00:00:00Z',
      retiredAt: null,
    });

    await expect(getModel({ id: 'nonexistent/model' }, { modelRegistryRepo: repo })).rejects.toThrow(
      "Model 'nonexistent/model' not found",
    );
  });
});
