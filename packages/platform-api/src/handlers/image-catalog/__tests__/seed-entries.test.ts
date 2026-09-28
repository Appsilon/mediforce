import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_IMAGE_CATALOG_ENTRIES } from '@mediforce/platform-core';
import {
  InMemoryAuditRepository,
  InMemoryImageCatalogRepository,
} from '@mediforce/platform-core/testing';
import { ForbiddenError, NotFoundError } from '../../../errors';
import { InMemoryNamespaceRepo } from '../../../testing/index';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { seedImageCatalogEntries } from '../seed-entries';

describe('seedImageCatalogEntries handler', () => {
  let repo: InMemoryImageCatalogRepository;
  let auditRepo: InMemoryAuditRepository;
  let namespaceRepo: InMemoryNamespaceRepo;

  beforeEach(async () => {
    repo = new InMemoryImageCatalogRepository();
    auditRepo = new InMemoryAuditRepository();
    namespaceRepo = new InMemoryNamespaceRepo();
    await namespaceRepo.createNamespace({
      handle: 'alpha',
      type: 'organization',
      displayName: 'Alpha',
      createdAt: new Date().toISOString(),
    });
  });

  const scopeFor = (uid: string, namespaces: string[]) =>
    createTestScope({
      imageCatalogRepo: repo,
      auditRepo,
      namespaceRepo,
      caller: userCaller(uid, namespaces),
    });

  it('seeds the defaults for a plain workspace member and writes audit', async () => {
    const result = await seedImageCatalogEntries({ namespace: 'alpha' }, scopeFor('u-member', ['alpha']));

    expect(result.seeded).toBe(DEFAULT_IMAGE_CATALOG_ENTRIES.length);
    expect(await repo.list('alpha')).toHaveLength(DEFAULT_IMAGE_CATALOG_ENTRIES.length);
    const event = auditRepo.getAll().find((entry) => entry.action === 'image_catalog.seeded');
    expect(event?.entityId).toBe('alpha');
  });

  it('refuses a caller who is not a member', async () => {
    await expect(
      seedImageCatalogEntries({ namespace: 'alpha' }, scopeFor('u-outsider', ['beta'])),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await repo.list('alpha')).toHaveLength(0);
  });

  it('refuses a handle no workspace holds, rather than writing rows nobody can open', async () => {
    // An apiKey caller — the backfill script — bypasses the membership gate, so
    // a typo would otherwise seed a workspace that does not exist.
    await expect(
      seedImageCatalogEntries({ namespace: 'typo' }, createTestScope({ imageCatalogRepo: repo, auditRepo, namespaceRepo })),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await repo.list('typo')).toHaveLength(0);
  });
});
