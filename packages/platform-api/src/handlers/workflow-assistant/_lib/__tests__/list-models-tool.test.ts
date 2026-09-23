import { describe, it, expect } from 'vitest';
import type { CreateModelRegistryEntryInput } from '@mediforce/platform-core';
import { InMemoryModelRegistryRepository } from '@mediforce/platform-core/testing';
import { runListModelsTool } from '../list-models-tool';
import { createTestScope } from '../../../../repositories/__tests__/create-test-scope';

function makeEntry(overrides: Partial<CreateModelRegistryEntryInput> & { id: string }): CreateModelRegistryEntryInput {
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
    source: 'openrouter',
    canonicalSlug: null,
    requestCount: null,
    lastSyncedAt: '2026-05-04T00:00:00Z',
    retiredAt: null,
    ...overrides,
  };
}

async function scopeWithModels(entries: CreateModelRegistryEntryInput[]) {
  const modelRegistryRepo = new InMemoryModelRegistryRepository();
  for (const entry of entries) {
    await modelRegistryRepo.upsert(entry);
  }
  return createTestScope({ modelRegistryRepo });
}

describe('runListModelsTool', () => {
  it('lists live models cheapest first, with what the assistant needs to pick one', async () => {
    const scope = await scopeWithModels([
      makeEntry({ id: 'anthropic/claude-sonnet-4', pricing: { input: 0.000003, output: 0.000015 }, supportsVision: true }),
      makeEntry({ id: 'deepseek/deepseek-chat', contextLength: 64000, pricing: { input: 0.0000002, output: 0.0000008 } }),
      makeEntry({ id: 'openai/gpt-4-retired', pricing: { input: 0, output: 0 }, retiredAt: '2026-06-01T00:00:00Z' }),
    ]);

    const result = await runListModelsTool(scope);

    expect(result).toEqual([
      {
        id: 'deepseek/deepseek-chat',
        name: 'deepseek/deepseek-chat',
        contextLength: 64000,
        inputPricePerToken: 0.0000002,
        outputPricePerToken: 0.0000008,
        supportsTools: true,
        supportsVision: false,
      },
      {
        id: 'anthropic/claude-sonnet-4',
        name: 'anthropic/claude-sonnet-4',
        contextLength: 128000,
        inputPricePerToken: 0.000003,
        outputPricePerToken: 0.000015,
        supportsTools: true,
        supportsVision: true,
      },
    ]);
  });

  it('caps the list at the 40 cheapest so it fits a turn', async () => {
    const entries = Array.from({ length: 45 }, (_unused, index) =>
      makeEntry({ id: `test/model-${index}`, pricing: { input: index, output: index } }));
    const scope = await scopeWithModels(entries);

    const result = await runListModelsTool(scope);

    expect(Array.isArray(result)).toBe(true);
    const ids = (result as Array<{ id: string }>).map((model) => model.id);
    expect(ids).toHaveLength(40);
    expect(ids[0]).toBe('test/model-0');
    expect(ids[39]).toBe('test/model-39');
  });
});
