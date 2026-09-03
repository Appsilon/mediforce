import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryImageCatalogRepository,
} from '@mediforce/platform-core/testing';
import { ForbiddenError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import type { DaemonImageListing } from '../../system/_docker';
import { TEALFLOW, UNREACHABLE_DAEMON } from './fixtures';

const daemon = vi.hoisted(() => ({
  value: { available: false, images: [] } as DaemonImageListing,
}));
vi.mock('../../system/_docker', () => ({
  fetchDaemonImages: async () => daemon.value,
  probeImageCapabilities: async () => ({ status: 'unknown' }),
  fetchImageHistory: async () => null,
}));

const { createImageCatalogEntry } = await import('../create-entry');
const { deleteImageCatalogEntry } = await import('../delete-entry');

describe('deleteImageCatalogEntry handler', () => {
  let repo: InMemoryImageCatalogRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    repo = new InMemoryImageCatalogRepository();
    auditRepo = new InMemoryAuditRepository();
    daemon.value = UNREACHABLE_DAEMON;
  });

  const scopeFor = (uid: string, namespaces: string[]) =>
    createTestScope({ imageCatalogRepo: repo, auditRepo, caller: userCaller(uid, namespaces) });

  it('removes the entry and audits the delete that removed it', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    const result = await deleteImageCatalogEntry(
      { namespace: 'alpha', id: created.entry.id },
      scope,
    );

    expect(result).toEqual({ success: true });
    expect(await repo.getById('alpha', created.entry.id)).toBeNull();
    const events = await auditRepo.getByEntity('imageCatalogEntry', created.entry.id);
    expect(events.filter((e) => e.action === 'image_catalog_entry.deleted')).toHaveLength(1);
  });

  it('is idempotent, and a no-op delete audits nothing', async () => {
    const scope = scopeFor('u-member', ['alpha']);

    await expect(
      deleteImageCatalogEntry({ namespace: 'alpha', id: 'nope-00000000' }, scope),
    ).resolves.toEqual({ success: true });
    expect(await auditRepo.getByEntity('imageCatalogEntry', 'nope-00000000')).toEqual([]);
  });

  it('refuses a caller who is not a member of the namespace', async () => {
    const owner = scopeFor('u-member', ['alpha']);
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, owner);
    const outsider = scopeFor('u-outsider', ['beta']);

    await expect(
      deleteImageCatalogEntry({ namespace: 'alpha', id: created.entry.id }, outsider),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await repo.getById('alpha', created.entry.id)).not.toBeNull();
  });
});
