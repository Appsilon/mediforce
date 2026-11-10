import { describe, expect, it } from 'vitest';
import type { ModelRegistryEntry } from '@mediforce/platform-core';
import { InMemoryNamespaceRepo } from '../../testing/in-memory-namespace-repo';
import { resolveOutputTokens } from '../output-tokens';

const createdAt = '2026-01-01T00:00:00.000Z';

function sources(options: { workspaceBudget?: 'low' | 'high' | 'max'; memberBudget?: 'low' | 'high'; modelLimit?: number | null } = {}) {
  const workspaces = new InMemoryNamespaceRepo();
  workspaces.seedNamespace({
    handle: 'acme',
    type: 'organization',
    displayName: 'Acme',
    createdAt,
    ...(options.workspaceBudget !== undefined ? { outputBudget: options.workspaceBudget } : {}),
  });
  workspaces.seedMember('acme', {
    uid: 'u1',
    role: 'member',
    joinedAt: createdAt,
    ...(options.memberBudget !== undefined ? { outputBudget: options.memberBudget } : {}),
  });
  const models = {
    async getById(id: string) {
      if (options.modelLimit === undefined) return null;
      return { id, maxCompletionTokens: options.modelLimit } as ModelRegistryEntry;
    },
  };
  return { workspaces, models };
}

describe('resolveOutputTokens', () => {
  it('keeps the default for a workspace with no budget', async () => {
    expect(await resolveOutputTokens(sources(), { namespace: 'acme', userId: 'u1', model: 'm', defaultTokens: 8_000 })).toBe(8_000);
  });

  it('applies the workspace budget', async () => {
    expect(
      await resolveOutputTokens(sources({ workspaceBudget: 'high', modelLimit: 64_000 }), { namespace: 'acme', userId: null, model: 'm', defaultTokens: 8_000 }),
    ).toBe(16_000);
  });

  it('applies a lower member budget for the member who makes the call', async () => {
    expect(
      await resolveOutputTokens(sources({ workspaceBudget: 'high', memberBudget: 'low' }), { namespace: 'acme', userId: 'u1', model: 'm', defaultTokens: 8_000 }),
    ).toBe(4_000);
  });

  it('applies a higher member budget over the workspace budget', async () => {
    expect(
      await resolveOutputTokens(sources({ memberBudget: 'high', modelLimit: 64_000 }), { namespace: 'acme', userId: 'u1', model: 'm', defaultTokens: 8_000 }),
    ).toBe(16_000);
  });

  it('ignores the member budget when no user makes the call', async () => {
    expect(
      await resolveOutputTokens(sources({ workspaceBudget: 'high', memberBudget: 'low', modelLimit: 64_000 }), { namespace: 'acme', userId: null, model: 'm', defaultTokens: 8_000 }),
    ).toBe(16_000);
  });

  it('caps at the model limit', async () => {
    expect(
      await resolveOutputTokens(sources({ workspaceBudget: 'max', modelLimit: 20_000 }), { namespace: 'acme', userId: null, model: 'm', defaultTokens: 8_000 }),
    ).toBe(20_000);
  });

  it('keeps the default for an unknown workspace', async () => {
    expect(await resolveOutputTokens(sources(), { namespace: null, userId: 'u1', model: 'm', defaultTokens: 4_096 })).toBe(4_096);
    expect(await resolveOutputTokens(sources(), { namespace: 'missing', userId: 'u1', model: 'm', defaultTokens: 4_096 })).toBe(4_096);
  });
});
