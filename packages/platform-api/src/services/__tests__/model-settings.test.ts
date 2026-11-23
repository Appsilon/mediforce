import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, type OutputBudget } from '@mediforce/platform-core';
import { InMemoryModelRegistryRepository } from '@mediforce/platform-core/testing';
import { InMemoryNamespaceRepo } from '../../testing/in-memory-namespace-repo';
import { registryEntry } from '../../handlers/evaluation/__tests__/fixture';
import { loadModelSettings, resolveDefaultModel, resolveOutputTokens } from '../model-settings';

const createdAt = '2026-01-01T00:00:00.000Z';

function workspaces(options: {
  workspace?: { outputBudget?: OutputBudget; defaultModel?: string };
  member?: { outputBudget?: OutputBudget; defaultModel?: string };
} = {}) {
  const repo = new InMemoryNamespaceRepo();
  repo.seedNamespace({ handle: 'acme', type: 'organization', displayName: 'Acme', createdAt, ...options.workspace });
  repo.seedMember('acme', { uid: 'u1', role: 'member', joinedAt: createdAt, ...options.member });
  return repo;
}

async function models() {
  const repo = new InMemoryModelRegistryRepository();
  await repo.upsert(registryEntry('openai/gpt-5.2', { maxCompletionTokens: 64_000 }));
  await repo.upsert(registryEntry('google/gemini-3-pro', { maxCompletionTokens: 20_000 }));
  await repo.upsert(registryEntry('openai/gpt-4', { retiredAt: createdAt }));
  await repo.upsert(registryEntry('acme/text-only', { supportsTools: false }));
  return repo;
}

describe('loadModelSettings', () => {
  it('takes each member setting over the workspace\'s, up or down', async () => {
    const repo = workspaces({ workspace: { outputBudget: 'high', defaultModel: 'openai/gpt-5.2' }, member: { outputBudget: 'low' } });
    expect(await loadModelSettings(repo, { namespace: 'acme', userId: 'u1' })).toEqual({ outputBudget: 'low', defaultModel: 'openai/gpt-5.2' });
  });

  it('gives an apiKey or system caller the workspace\'s settings', async () => {
    const repo = workspaces({ workspace: { outputBudget: 'high' }, member: { outputBudget: 'low', defaultModel: 'google/gemini-3-pro' } });
    expect(await loadModelSettings(repo, { namespace: 'acme', userId: null })).toEqual({ outputBudget: 'high', defaultModel: undefined });
  });

  it('is the default budget and no model for no workspace or an unknown one', async () => {
    const empty = { outputBudget: 'default', defaultModel: undefined };
    expect(await loadModelSettings(workspaces(), { namespace: null, userId: 'u1' })).toEqual(empty);
    expect(await loadModelSettings(workspaces(), { namespace: 'missing', userId: 'u1' })).toEqual(empty);
  });
});

describe('resolveDefaultModel', () => {
  it('is the platform default when no model is set', async () => {
    expect(await resolveDefaultModel(await models(), { outputBudget: 'default', defaultModel: undefined })).toBe(DEFAULT_MODEL);
  });

  it('takes a live, tool-capable default and falls back for a retired or tool-less one', async () => {
    const registry = await models();
    expect(await resolveDefaultModel(registry, { outputBudget: 'default', defaultModel: 'openai/gpt-5.2' })).toBe('openai/gpt-5.2');
    expect(await resolveDefaultModel(registry, { outputBudget: 'default', defaultModel: 'openai/gpt-4' })).toBe(DEFAULT_MODEL);
    expect(await resolveDefaultModel(registry, { outputBudget: 'default', defaultModel: 'acme/text-only' })).toBe(DEFAULT_MODEL);
  });
});

describe('resolveOutputTokens', () => {
  it('scales the call\'s default by the budget, within the model\'s limit', async () => {
    const registry = await models();
    const call = { model: 'openai/gpt-5.2', defaultTokens: 8_000 };
    expect(await resolveOutputTokens(registry, { outputBudget: 'default', defaultModel: undefined }, call)).toBe(8_000);
    expect(await resolveOutputTokens(registry, { outputBudget: 'low', defaultModel: undefined }, call)).toBe(4_000);
    expect(await resolveOutputTokens(registry, { outputBudget: 'high', defaultModel: undefined }, call)).toBe(16_000);
    expect(await resolveOutputTokens(registry, { outputBudget: 'max', defaultModel: undefined }, call)).toBe(64_000);
    expect(await resolveOutputTokens(registry, { outputBudget: 'high', defaultModel: undefined }, { model: 'google/gemini-3-pro', defaultTokens: 16_000 })).toBe(20_000);
  });

  it('gives a call on the platform default the limit of the model it stands for today', async () => {
    const registry = await models();
    await registry.upsert(registryEntry('anthropic/claude-sonnet-5.5', { maxCompletionTokens: 64_000 }));
    expect(await resolveOutputTokens(registry, { outputBudget: 'max', defaultModel: undefined }, { model: DEFAULT_MODEL, defaultTokens: 8_000 })).toBe(64_000);
  });

  it('does not raise for a model the registry does not know', async () => {
    expect(await resolveOutputTokens(await models(), { outputBudget: 'max', defaultModel: undefined }, { model: 'nobody/unknown', defaultTokens: 8_000 })).toBe(8_000);
  });
});
