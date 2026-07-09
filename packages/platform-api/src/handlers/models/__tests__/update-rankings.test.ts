import { describe, expect, it } from 'vitest';
import { InMemoryModelRegistryRepository } from '@mediforce/platform-core/testing';
import { updateRankings } from '../update-rankings';

describe('updateRankings handler', () => {
  it('returns updated count and timestamp', async () => {
    const repo = new InMemoryModelRegistryRepository();
    await repo.upsert({
      id: 'test/model',
      name: 'model',
      provider: 'test',
      contextLength: 0,
      maxCompletionTokens: null,
      pricing: { input: 0, output: 0 },
      modality: 'text->text',
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsTools: false,
      supportsVision: false,
      source: 'openrouter',
      canonicalSlug: null,
      requestCount: null,
      lastSyncedAt: '',
      retiredAt: null,
    });

    const result = await updateRankings(
      { rankings: [{ id: 'test/model', requestCount: 1000 }] },
      { modelRegistryRepo: repo },
    );
    expect(result.updated).toBe(1);
    expect(typeof result.rankingsUpdatedAt).toBe('string');
  });
});
