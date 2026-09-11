import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryImageCatalogRepository,
} from '@mediforce/platform-core/testing';
import { ForbiddenError, NotFoundError } from '../../../errors';
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
const { updateImageCatalogEntry } = await import('../update-entry');

describe('updateImageCatalogEntry handler', () => {
  let repo: InMemoryImageCatalogRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    repo = new InMemoryImageCatalogRepository();
    auditRepo = new InMemoryAuditRepository();
    daemon.value = UNREACHABLE_DAEMON;
  });

  const scopeFor = (uid: string, namespaces: string[]) =>
    createTestScope({ imageCatalogRepo: repo, auditRepo, caller: userCaller(uid, namespaces) });

  it('rewrites the intent and leaves the key alone', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    const { entry } = await updateImageCatalogEntry(
      { namespace: 'alpha', id: created.entry.id, intent: 'Now with renv pinning' },
      scope,
    );

    expect(entry.id).toBe(created.entry.id);
    expect(entry.intent).toBe('Now with renv pinning');
    expect(entry.name).toBe(TEALFLOW.name);
    expect(entry.source).toEqual(created.entry.source);
  });

  it('writes an audit event naming the fields that changed', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    await updateImageCatalogEntry(
      { namespace: 'alpha', id: created.entry.id, name: 'TealFlow (R 4.4)' },
      scope,
    );

    const events = await auditRepo.getByEntity('imageCatalogEntry', created.entry.id);
    const updates = events.filter((e) => e.action === 'image_catalog_entry.updated');
    expect(updates).toHaveLength(1);
    expect(updates[0].inputSnapshot).toMatchObject({ patchKeys: ['name'] });
  });

  it('404s an id nobody catalogued', async () => {
    const scope = scopeFor('u-member', ['alpha']);

    await expect(
      updateImageCatalogEntry({ namespace: 'alpha', id: 'nope-00000000', name: 'x' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a caller who is not a member of the namespace', async () => {
    const owner = scopeFor('u-member', ['alpha']);
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, owner);
    const outsider = scopeFor('u-outsider', ['beta']);

    await expect(
      updateImageCatalogEntry({ namespace: 'alpha', id: created.entry.id, name: 'x' }, outsider),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
