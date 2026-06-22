import { describe, it, expect } from 'vitest';
import type { ModelRegistryRepository } from '@mediforce/platform-core';
import { validateModels } from '../validate-models';

const KNOWN_MODELS = [
  { id: 'anthropic/claude-3.5-haiku', provider: 'anthropic', name: 'Haiku', contextLength: 200000, maxCompletionTokens: 8192, pricing: { input: 0.001, output: 0.005 }, modality: 'text->text', inputModalities: ['text'], outputModalities: ['text'], supportsTools: true, supportsVision: false, source: 'openrouter' as const, requestCount: null, lastSyncedAt: null, createdAt: '2025-01-01', updatedAt: '2025-01-01', retiredAt: null },
  { id: 'anthropic/claude-sonnet-4', provider: 'anthropic', name: 'Sonnet', contextLength: 200000, maxCompletionTokens: 8192, pricing: { input: 0.003, output: 0.015 }, modality: 'text->text', inputModalities: ['text'], outputModalities: ['text'], supportsTools: true, supportsVision: false, source: 'openrouter' as const, requestCount: null, lastSyncedAt: null, createdAt: '2025-01-01', updatedAt: '2025-01-01', retiredAt: null },
  { id: 'openai/gpt-4o', provider: 'openai', name: 'GPT-4o', contextLength: 128000, maxCompletionTokens: 4096, pricing: { input: 0.005, output: 0.015 }, modality: 'text->text', inputModalities: ['text'], outputModalities: ['text'], supportsTools: true, supportsVision: true, source: 'openrouter' as const, requestCount: null, lastSyncedAt: null, createdAt: '2025-01-01', updatedAt: '2025-01-01', retiredAt: null },
];

function makeDeps() {
  return {
    modelRegistryRepo: {
      list: async () => KNOWN_MODELS,
    } as unknown as ModelRegistryRepository,
  };
}

describe('validateModels', () => {
  it('returns empty unknown array when all models exist', async () => {
    const result = await validateModels(
      { modelIds: ['anthropic/claude-3.5-haiku', 'anthropic/claude-sonnet-4'] },
      makeDeps(),
    );
    expect(result.unknown).toEqual([]);
  });

  it('detects unknown model and suggests closest match', async () => {
    const result = await validateModels(
      { modelIds: ['anthropic/claude-haiku-3.5'] },
      makeDeps(),
    );
    expect(result.unknown).toHaveLength(1);
    expect(result.unknown[0].id).toBe('anthropic/claude-haiku-3.5');
    expect(result.unknown[0].suggestion).toBe('anthropic/claude-3.5-haiku');
  });

  it('detects bare alias with no close match', async () => {
    const result = await validateModels(
      { modelIds: ['some-totally-unknown-model'] },
      makeDeps(),
    );
    expect(result.unknown).toHaveLength(1);
    expect(result.unknown[0].id).toBe('some-totally-unknown-model');
    expect(result.unknown[0].suggestion).toBeNull();
  });

  it('handles mix of known and unknown', async () => {
    const result = await validateModels(
      { modelIds: ['anthropic/claude-sonnet-4', 'sonnet', 'openai/gpt-4o'] },
      makeDeps(),
    );
    expect(result.unknown).toHaveLength(1);
    expect(result.unknown[0].id).toBe('sonnet');
  });
});
