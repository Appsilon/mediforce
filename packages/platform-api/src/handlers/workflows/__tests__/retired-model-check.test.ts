import { describe, it, expect } from 'vitest';
import { checkRetiredModels } from '../retired-model-check';
import type { ModelRegistryEntry } from '@mediforce/platform-core';

const baseEntry: ModelRegistryEntry = {
  id: 'openai/gpt-4o',
  name: 'GPT-4o',
  provider: 'openai',
  contextLength: 128000,
  promptPricing: 5,
  completionPricing: 15,
  supportsTools: true,
  supportsVision: true,
  ranking: null,
  retiredAt: null,
  lastSyncedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const retiredEntry: ModelRegistryEntry = {
  ...baseEntry,
  id: 'openai/gpt-3.5-turbo',
  name: 'GPT-3.5 Turbo',
  retiredAt: '2026-01-15T00:00:00.000Z',
};

const workflow = {
  steps: [
    { id: 's1', name: 'Step 1', executor: 'agent' as const, agent: { model: 'openai/gpt-4o' } },
    { id: 's2', name: 'Step 2', executor: 'agent' as const, agent: { model: 'openai/gpt-3.5-turbo' } },
  ],
};

describe('checkRetiredModels', () => {
  it('returns null when no models are retired', () => {
    const result = checkRetiredModels(workflow, [baseEntry]);
    expect(result).toBeNull();
  });

  it('returns refs and message when retired models found', () => {
    const result = checkRetiredModels(workflow, [baseEntry, retiredEntry]);
    expect(result).not.toBeNull();
    expect(result!.refs).toHaveLength(1);
    expect(result!.refs[0].model).toBe('openai/gpt-3.5-turbo');
    expect(result!.message).toContain('retired');
    expect(result!.message).toContain('2026-01-15');
  });
});
