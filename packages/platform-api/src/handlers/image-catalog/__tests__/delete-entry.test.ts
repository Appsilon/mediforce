import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryImageCatalogRepository,
} from '@mediforce/platform-core/testing';
import { ForbiddenError, PreconditionFailedError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import type { DaemonImageListing } from '../../system/_docker';
import { TEALFLOW, builtImage, daemonWith, UNREACHABLE_DAEMON } from './fixtures';

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

  /** An admin of `alpha` plus a docker deleter that records what it was asked
   *  to remove — the daemon side of the composite delete. */
  const adminScopeWith = (deleter: {
    delete: (imageId: string) => Promise<{ deleted: string; output?: string }>;
  }) =>
    createTestScope({
      imageCatalogRepo: repo,
      auditRepo,
      dockerImages: deleter,
      caller: userCaller('u-admin', ['alpha'], new Map([['alpha', 'admin']])),
    });

  /** Two versions of the TealFlow entry, so a delete has more than one tag to
   *  remove and cannot pass by handling only the newest. */
  const TWO_VERSIONS = daemonWith([
    builtImage({ tag: 'aaaaaaaaaaaa', id: 'sha-new' }),
    builtImage({ tag: 'bbbbbbbbbbbb', id: 'sha-old' }),
  ]);

  it('removes the entry and audits the delete that removed it', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    const result = await deleteImageCatalogEntry(
      { namespace: 'alpha', id: created.entry.id },
      scope,
    );

    expect(result).toEqual({ success: true, deletedImages: [] });
    expect(await repo.getById('alpha', created.entry.id)).toBeNull();
    const events = await auditRepo.getByEntity('imageCatalogEntry', created.entry.id);
    expect(events.filter((e) => e.action === 'image_catalog_entry.deleted')).toHaveLength(1);
  });

  it('is idempotent, and a no-op delete audits nothing', async () => {
    const scope = scopeFor('u-member', ['alpha']);

    await expect(
      deleteImageCatalogEntry({ namespace: 'alpha', id: 'nope-00000000' }, scope),
    ).resolves.toEqual({ success: true, deletedImages: [] });
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

  it('leaves the daemon alone when only the entry was asked for', async () => {
    const removed: string[] = [];
    daemon.value = TWO_VERSIONS;
    const scope = adminScopeWith({
      delete: async (imageId) => {
        removed.push(imageId);
        return { deleted: imageId };
      },
    });
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    await deleteImageCatalogEntry({ namespace: 'alpha', id: created.entry.id }, scope);

    // Removing an entry removes an offer, never a capability (ADR-0022
    // decision 3). The images are the capability, and nobody asked.
    expect(removed).toEqual([]);
    expect(await repo.getById('alpha', created.entry.id)).toBeNull();
  });

  it('removes every version tag from the daemon, then the entry', async () => {
    const removed: string[] = [];
    daemon.value = TWO_VERSIONS;
    const scope = adminScopeWith({
      delete: async (imageId) => {
        removed.push(imageId);
        return { deleted: imageId };
      },
    });
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    const result = await deleteImageCatalogEntry(
      { namespace: 'alpha', id: created.entry.id, withImages: true },
      scope,
    );

    // By tag, not by image id: a tag names exactly what this entry offered, so
    // an image another tag still references survives instead of needing --force.
    expect(removed.sort()).toEqual([
      'mediforce-built:aaaaaaaaaaaa',
      'mediforce-built:bbbbbbbbbbbb',
    ]);
    expect(result.deletedImages.sort()).toEqual([
      'mediforce-built:aaaaaaaaaaaa',
      'mediforce-built:bbbbbbbbbbbb',
    ]);
    expect(await repo.getById('alpha', created.entry.id)).toBeNull();
    // Destroying an image is deployment-wide, so it audits under `_system`
    // rather than under the namespace that happened to ask.
    const imageEvents = await auditRepo.getByEntity(
      'docker_image',
      'mediforce-built:aaaaaaaaaaaa',
    );
    expect(imageEvents.some((event) => event.action === 'docker_image.deleted')).toBe(true);
  });

  it('refuses a plain member the image half, and deletes nothing at all', async () => {
    const removed: string[] = [];
    daemon.value = TWO_VERSIONS;
    const member = createTestScope({
      imageCatalogRepo: repo,
      auditRepo,
      dockerImages: {
        delete: async (imageId) => {
          removed.push(imageId);
          return { deleted: imageId };
        },
      },
      caller: userCaller('u-member', ['alpha']),
    });
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, member);

    await expect(
      deleteImageCatalogEntry({ namespace: 'alpha', id: created.entry.id, withImages: true }, member),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // The gate has to bite before anything is destroyed: a member who cannot
    // delete images must not get a half-done delete either.
    expect(removed).toEqual([]);
    expect(await repo.getById('alpha', created.entry.id)).not.toBeNull();
  });

  it('keeps the entry when an image will not delete', async () => {
    daemon.value = TWO_VERSIONS;
    const scope = adminScopeWith({
      delete: async (imageId) => {
        if (imageId === 'mediforce-built:bbbbbbbbbbbb') {
          throw new Error('conflict: unable to delete (must be forced) - image is being used');
        }
        return { deleted: imageId };
      },
    });
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    await expect(
      deleteImageCatalogEntry({ namespace: 'alpha', id: created.entry.id, withImages: true }, scope),
    ).rejects.toThrow(/being used/);

    // The entry is the only handle anyone has on the images left behind, so
    // removing the row here would orphan them under a name nobody wrote.
    expect(await repo.getById('alpha', created.entry.id)).not.toBeNull();
  });

  it('says so when the deployment cannot delete images at all', async () => {
    daemon.value = TWO_VERSIONS;
    const scope = createTestScope({
      imageCatalogRepo: repo,
      auditRepo,
      dockerImages: null,
      caller: userCaller('u-admin', ['alpha'], new Map([['alpha', 'admin']])),
    });
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    await expect(
      deleteImageCatalogEntry({ namespace: 'alpha', id: created.entry.id, withImages: true }, scope),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
    expect(await repo.getById('alpha', created.entry.id)).not.toBeNull();
  });

  it('deletes the entry when the daemon holds nothing to remove', async () => {
    daemon.value = UNREACHABLE_DAEMON;
    const scope = adminScopeWith({
      delete: async () => {
        throw new Error('nothing should be deleted');
      },
    });
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    const result = await deleteImageCatalogEntry(
      { namespace: 'alpha', id: created.entry.id, withImages: true },
      scope,
    );

    expect(result.deletedImages).toEqual([]);
    expect(await repo.getById('alpha', created.entry.id)).toBeNull();
  });

  it('removes the images of an entry that was never a row', async () => {
    const removed: string[] = [];
    // Discovery only offers what the platform built *for this namespace*, which
    // the build recorded — so these images carry that label.
    const builtHere = daemonWith([
      builtImage({ tag: 'aaaaaaaaaaaa', id: 'sha-new', buildNamespace: 'alpha' }),
      builtImage({ tag: 'bbbbbbbbbbbb', id: 'sha-old', buildNamespace: 'alpha' }),
    ]);
    daemon.value = builtHere;
    const scope = adminScopeWith({
      delete: async (imageId) => {
        removed.push(imageId);
        return { deleted: imageId };
      },
    });
    // Nothing catalogued: the TealFlow images on the daemon are a *discovered*
    // entry, derived on read (ADR-0022 decision 7).
    const { discoverEntries } = await import('../_discovered');
    const [discovered] = discoverEntries('alpha', builtHere.images, []);
    expect(discovered).toBeDefined();

    const result = await deleteImageCatalogEntry(
      { namespace: 'alpha', id: discovered.id, withImages: true },
      scope,
    );

    // There is no record to remove, so the images are the whole act — and a
    // missing row must not read as "nothing to do".
    expect(removed.sort()).toEqual([
      'mediforce-built:aaaaaaaaaaaa',
      'mediforce-built:bbbbbbbbbbbb',
    ]);
    expect(result.deletedImages).toHaveLength(2);
  });

  it('refuses the image half to an admin of some other workspace', async () => {
    const removed: string[] = [];
    daemon.value = TWO_VERSIONS;
    const owner = scopeFor('u-member', ['alpha']);
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, owner);
    // Admin of `beta`, plain member of `alpha`. The gate under
    // `deleteDockerImage` is documented as loose — owner or admin of *any*
    // namespace — and this caller satisfies it, which is why the handler asks
    // the stricter per-workspace question instead.
    const elsewhere = createTestScope({
      imageCatalogRepo: repo,
      auditRepo,
      dockerImages: {
        delete: async (imageId) => {
          removed.push(imageId);
          return { deleted: imageId };
        },
      },
      caller: userCaller('u-other-admin', ['alpha', 'beta'], new Map([['beta', 'admin']])),
    });

    await expect(
      deleteImageCatalogEntry(
        { namespace: 'alpha', id: created.entry.id, withImages: true },
        elsewhere,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(removed).toEqual([]);
    expect(await repo.getById('alpha', created.entry.id)).not.toBeNull();
  });
});
