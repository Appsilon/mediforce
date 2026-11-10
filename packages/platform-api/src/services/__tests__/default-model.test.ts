import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, type ModelRegistryEntry } from '@mediforce/platform-core';
import { InMemoryNamespaceRepo } from '../../testing/in-memory-namespace-repo';
import { resolveDefaultModel } from '../default-model';

const createdAt = '2026-01-01T00:00:00.000Z';

function sources(options: { workspaceModel?: string; memberModel?: string; retired?: string[]; noTools?: string[] } = {}) {
  const workspaces = new InMemoryNamespaceRepo();
  workspaces.seedNamespace({
    handle: 'acme',
    type: 'organization',
    displayName: 'Acme',
    createdAt,
    ...(options.workspaceModel !== undefined ? { defaultModel: options.workspaceModel } : {}),
  });
  workspaces.seedMember('acme', {
    uid: 'u1',
    role: 'member',
    joinedAt: createdAt,
    ...(options.memberModel !== undefined ? { defaultModel: options.memberModel } : {}),
  });
  const retired = new Set(options.retired ?? []);
  const noTools = new Set(options.noTools ?? []);
  const models = {
    async getById(id: string) {
      return { id, retiredAt: retired.has(id) ? createdAt : null, supportsTools: noTools.has(id) === false } as ModelRegistryEntry;
    },
  };
  return { workspaces, models };
}

describe('resolveDefaultModel', () => {
  it('is the platform default when nothing is set', async () => {
    expect(await resolveDefaultModel(sources(), { namespace: 'acme', userId: 'u1' })).toBe(DEFAULT_MODEL);
  });

  it('takes the workspace default', async () => {
    expect(await resolveDefaultModel(sources({ workspaceModel: 'openai/gpt-5.2' }), { namespace: 'acme', userId: null })).toBe('openai/gpt-5.2');
  });

  it('takes the member default over the workspace one for the member who makes the call', async () => {
    const both = sources({ workspaceModel: 'openai/gpt-5.2', memberModel: 'google/gemini-3-pro' });
    expect(await resolveDefaultModel(both, { namespace: 'acme', userId: 'u1' })).toBe('google/gemini-3-pro');
    expect(await resolveDefaultModel(both, { namespace: 'acme', userId: null })).toBe('openai/gpt-5.2');
  });

  it('falls back to the platform default for a model that cannot call tools', async () => {
    expect(
      await resolveDefaultModel(sources({ workspaceModel: 'acme/text-only', noTools: ['acme/text-only'] }), { namespace: 'acme', userId: null }),
    ).toBe(DEFAULT_MODEL);
  });

  it('falls back to the platform default for a retired model or no workspace', async () => {
    expect(
      await resolveDefaultModel(sources({ workspaceModel: 'openai/gpt-4', retired: ['openai/gpt-4'] }), { namespace: 'acme', userId: null }),
    ).toBe(DEFAULT_MODEL);
    expect(await resolveDefaultModel(sources(), { namespace: null, userId: 'u1' })).toBe(DEFAULT_MODEL);
  });
});
