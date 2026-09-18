import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_IMAGE_CATALOG_ENTRIES } from '@mediforce/platform-core';
import { InMemoryImageCatalogRepository } from '@mediforce/platform-core/testing';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { seedDefaultImageCatalogEntries } from '../_seed';

describe('seedDefaultImageCatalogEntries', () => {
  let repo: InMemoryImageCatalogRepository;

  beforeEach(() => {
    repo = new InMemoryImageCatalogRepository();
  });

  it('writes one entry per engine default, keyed on an untagged repository', async () => {
    const scope = createTestScope({ imageCatalogRepo: repo, caller: userCaller('u-1', []) });

    const seeded = await seedDefaultImageCatalogEntries('fresh', scope);

    expect(seeded).toBe(DEFAULT_IMAGE_CATALOG_ENTRIES.length);
    const entries = await repo.list('fresh');
    expect(entries.map((entry) => entry.source)).toEqual(
      DEFAULT_IMAGE_CATALOG_ENTRIES.map((seed) => ({ kind: 'referenced', reference: seed.reference })),
    );
    // A tag would key five rows where the catalog wants one with five versions
    // (ADR-0022 decision 1), so no seed may carry one.
    expect(entries.some((entry) => entry.source.kind === 'referenced' && entry.source.reference.includes(':'))).toBe(false);
  });

  it('writes through the ungated repository, so the workspace creator is not refused', async () => {
    // `caller.namespaces` is resolved before the request, so a caller who just
    // created `fresh` is not a member of it yet as far as the wrapper is
    // concerned — the seed must not go through `scope.imageCatalog`.
    const scope = createTestScope({ imageCatalogRepo: repo, caller: userCaller('u-1', ['other']) });

    expect(await seedDefaultImageCatalogEntries('fresh', scope)).toBe(
      DEFAULT_IMAGE_CATALOG_ENTRIES.length,
    );
  });

  it('is idempotent — the same source upserts the same row', async () => {
    const scope = createTestScope({ imageCatalogRepo: repo, caller: userCaller('u-1', []) });

    await seedDefaultImageCatalogEntries('fresh', scope);
    await seedDefaultImageCatalogEntries('fresh', scope);

    expect(await repo.list('fresh')).toHaveLength(DEFAULT_IMAGE_CATALOG_ENTRIES.length);
  });

  it('preserves a member-edited default entry when re-seeded', async () => {
    const scope = createTestScope({ imageCatalogRepo: repo, caller: userCaller('u-1', []) });
    await seedDefaultImageCatalogEntries('fresh', scope);
    const [entry] = await repo.list('fresh');
    if (entry === undefined) throw new Error('expected a seeded entry');
    await repo.upsert('fresh', {
      ...entry,
      name: 'Our golden image',
      intent: 'The image our team uses for agents.',
      capabilities: { 'sha-ours': { status: 'known', agentCapable: true, runtimes: ['bash'] } },
    });

    await seedDefaultImageCatalogEntries('fresh', scope);

    await expect(repo.getById('fresh', entry.id)).resolves.toMatchObject({
      name: 'Our golden image',
      intent: 'The image our team uses for agents.',
      capabilities: { 'sha-ours': { status: 'known', agentCapable: true, runtimes: ['bash'] } },
    });
  });

  it('seeds nothing rather than throwing when the catalog refuses the write', async () => {
    repo.upsert = async () => {
      throw new Error('image catalog unavailable');
    };
    const scope = createTestScope({ imageCatalogRepo: repo, caller: userCaller('u-1', []) });

    expect(await seedDefaultImageCatalogEntries('fresh', scope)).toBe(0);
  });
});
