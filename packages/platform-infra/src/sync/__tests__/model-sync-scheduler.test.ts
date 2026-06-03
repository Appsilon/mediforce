import { describe, it, expect } from 'vitest';
import { InMemoryModelRegistryRepository } from '@mediforce/platform-core/testing';
import { isRegistryStale } from '../model-sync-scheduler';

function makeEntry(lastSyncedAt: string) {
  return {
    id: `model-${lastSyncedAt}`,
    canonicalSlug: null,
    name: 'Test Model',
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
    lastSyncedAt,
    retiredAt: null,
  };
}

describe('isRegistryStale', () => {
  it('returns true for an empty registry', async () => {
    const repo = new InMemoryModelRegistryRepository();
    const stale = await isRegistryStale(repo);
    expect(stale).toBe(true);
  });

  it('returns false when the most recent sync is within the threshold', async () => {
    const repo = new InMemoryModelRegistryRepository();
    const recentTs = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago
    await repo.upsert(makeEntry(recentTs));
    const stale = await isRegistryStale(repo);
    expect(stale).toBe(false);
  });

  it('returns true when the most recent sync is older than the threshold', async () => {
    const repo = new InMemoryModelRegistryRepository();
    const oldTs = new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(); // 25 hours ago
    await repo.upsert(makeEntry(oldTs));
    const stale = await isRegistryStale(repo);
    expect(stale).toBe(true);
  });

  it('uses the most recent lastSyncedAt across all models', async () => {
    const repo = new InMemoryModelRegistryRepository();
    const oldTs = new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(); // 25 hours ago
    const recentTs = new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(); // 2 hours ago
    await repo.upsert({ ...makeEntry(oldTs), id: 'model-old' });
    await repo.upsert({ ...makeEntry(recentTs), id: 'model-recent' });
    const stale = await isRegistryStale(repo);
    expect(stale).toBe(false);
  });

  it('respects a custom threshold', async () => {
    const repo = new InMemoryModelRegistryRepository();
    const ts = new Date(Date.now() - 1000 * 60 * 10).toISOString(); // 10 minutes ago
    await repo.upsert(makeEntry(ts));
    // threshold = 5 minutes → stale
    const stale = await isRegistryStale(repo, 1000 * 60 * 5);
    expect(stale).toBe(true);
    // threshold = 1 hour → fresh
    const fresh = await isRegistryStale(repo, 1000 * 60 * 60);
    expect(fresh).toBe(false);
  });
});
