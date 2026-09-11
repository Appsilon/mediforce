import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildWorkflowDefinition,
  InMemoryAuditRepository,
  InMemoryImageCatalogRepository,
  InMemoryProcessRepository,
} from '@mediforce/platform-core/testing';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { ConflictError, ForbiddenError, PreconditionFailedError } from '../../../errors';
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

  /** Admin of `alpha`. Every delete needs it, image half or not. */
  const adminScope = () =>
    createTestScope({
      imageCatalogRepo: repo,
      auditRepo,
      caller: userCaller('u-admin', ['alpha'], new Map([['alpha', 'admin']])),
    });

  /** An admin of `alpha` plus a docker deleter that records what it was asked
   *  to remove — the daemon side of the composite delete. */
  const adminScopeWith = async (
    deleter: {
      delete: (imageId: string) => Promise<{ deleted: string; output?: string }>;
    },
    definitions?: WorkflowDefinition[],
  ) => {
    // Seeded through the raw repo, not `scope.workflowDefinitions.save`: the
    // authorized wrapper refuses a write to a namespace the caller is not a
    // member of, and a foreign-namespace pin is exactly what the block has to
    // notice.
    const processRepo = new InMemoryProcessRepository();
    for (const definition of definitions ?? []) {
      await processRepo.saveWorkflowDefinition(definition);
    }
    return createTestScope({
      imageCatalogRepo: repo,
      auditRepo,
      processRepo,
      dockerImages: deleter,
      caller: userCaller('u-admin', ['alpha'], new Map([['alpha', 'admin']])),
    });
  };

  /** A workflow version pinning `image`, at `version`. */
  const pinning = (
    image: string,
    overrides: Partial<WorkflowDefinition> = {},
  ): WorkflowDefinition =>
    buildWorkflowDefinition({
      name: 'sdtm-qc',
      namespace: 'alpha',
      version: 1,
      steps: [
        {
          id: 'analyse',
          name: 'Analyse',
          type: 'creation',
          executor: 'agent',
          autonomyLevel: 'L2',
          agent: { image },
        },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'analyse', to: 'done' }],
      ...overrides,
    });

  /** Two versions of the TealFlow entry, so a delete has more than one tag to
   *  remove and cannot pass by handling only the newest. */
  const TWO_VERSIONS = daemonWith([
    builtImage({ tag: 'aaaaaaaaaaaa', id: 'sha-new' }),
    builtImage({ tag: 'bbbbbbbbbbbb', id: 'sha-old' }),
  ]);

  it('removes the entry and audits the delete that removed it', async () => {
    const scope = adminScope();
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
    const scope = adminScope();

    await expect(
      deleteImageCatalogEntry({ namespace: 'alpha', id: 'nope-00000000' }, scope),
    ).resolves.toEqual({ success: true, deletedImages: [] });
    expect(await auditRepo.getByEntity('imageCatalogEntry', 'nope-00000000')).toEqual([]);
  });

  it('refuses a caller who is not a member of the namespace', async () => {
    const owner = adminScope();
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
    const scope = await adminScopeWith({
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
    const scope = await adminScopeWith({
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
    const scope = await adminScopeWith({
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
    const scope = await adminScopeWith({
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
    const scope = await adminScopeWith({
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

  it('refuses to destroy an image a live workflow version still pins', async () => {
    const removed: string[] = [];
    daemon.value = TWO_VERSIONS;
    const scope = await adminScopeWith(
      {
        delete: async (imageId) => {
          removed.push(imageId);
          return { deleted: imageId };
        },
      },
      [pinning('mediforce-built:aaaaaaaaaaaa')],
    );
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    await expect(
      deleteImageCatalogEntry({ namespace: 'alpha', id: created.entry.id, withImages: true }, scope),
    ).rejects.toBeInstanceOf(ConflictError);

    // Nothing destroyed and nothing removed: a run that would fail at
    // container start is breakage the caller can still prevent.
    expect(removed).toEqual([]);
    expect(await repo.getById('alpha', created.entry.id)).not.toBeNull();
  });

  it('names the blocking workflow and version, so the message is actionable', async () => {
    daemon.value = TWO_VERSIONS;
    const scope = await adminScopeWith(
      { delete: async (imageId) => ({ deleted: imageId }) },
      [pinning('mediforce-built:aaaaaaaaaaaa', { version: 4 })],
    );
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    await expect(
      deleteImageCatalogEntry({ namespace: 'alpha', id: created.entry.id, withImages: true }, scope),
    ).rejects.toThrow(/alpha\/sdtm-qc v4/);
  });

  it('deletes anyway when only a superseded version pins it', async () => {
    const removed: string[] = [];
    daemon.value = TWO_VERSIONS;
    const scope = await adminScopeWith(
      {
        delete: async (imageId) => {
          removed.push(imageId);
          return { deleted: imageId };
        },
      },
      [
        // v1 pins the image; v2 is the live one and points elsewhere.
        pinning('mediforce-built:aaaaaaaaaaaa', { version: 1 }),
        pinning('unrelated:v1', { version: 2 }),
      ],
    );
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    const result = await deleteImageCatalogEntry(
      { namespace: 'alpha', id: created.entry.id, withImages: true },
      scope,
    );

    // A registered version is immutable, so no edit can move v1 off this
    // image. Refusing on its account would mean the image can never be
    // reclaimed.
    expect(result.deletedImages).toHaveLength(2);
    expect(removed).toHaveLength(2);
    expect(await repo.getById('alpha', created.entry.id)).toBeNull();
  });

  it('blocks on a live version in a workspace the caller cannot see, without naming it', async () => {
    daemon.value = TWO_VERSIONS;
    const scope = await adminScopeWith(
      { delete: async (imageId) => ({ deleted: imageId }) },
      [pinning('mediforce-built:aaaaaaaaaaaa', { namespace: 'beta', name: 'secret-qc' })],
    );
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    // The daemon is deployment-wide, so a step in `beta` breaks just the same
    // — but its private name is not this caller's to read.
    let failure: unknown;
    try {
      await deleteImageCatalogEntry(
        { namespace: 'alpha', id: created.entry.id, withImages: true },
        scope,
      );
    } catch (err) {
      failure = err;
    }

    expect(failure).toBeInstanceOf(ConflictError);
    expect((failure as Error).message).not.toMatch(/secret-qc/);
    expect((failure as Error).message).toMatch(/cannot see/);
  });

  it('lets a live pin block even when the entry has no record, only images', async () => {
    const builtHere = daemonWith([
      builtImage({ tag: 'aaaaaaaaaaaa', id: 'sha-new', buildNamespace: 'alpha' }),
    ]);
    daemon.value = builtHere;
    const scope = await adminScopeWith(
      { delete: async (imageId) => ({ deleted: imageId }) },
      [pinning('mediforce-built:aaaaaaaaaaaa')],
    );
    const { discoverEntries } = await import('../_discovered');
    const [discovered] = discoverEntries('alpha', builtHere.images, []);

    await expect(
      deleteImageCatalogEntry(
        { namespace: 'alpha', id: discovered.id, withImages: true },
        scope,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses a plain member the whole delete, not only the image half', async () => {
    const admin = adminScope();
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, admin);
    const member = scopeFor('u-member', ['alpha']);

    // An entry exists *for* its images, so a record-only delete is not a
    // lesser act with a lighter gate.
    await expect(
      deleteImageCatalogEntry({ namespace: 'alpha', id: created.entry.id }, member),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await repo.getById('alpha', created.entry.id)).not.toBeNull();
  });
});
