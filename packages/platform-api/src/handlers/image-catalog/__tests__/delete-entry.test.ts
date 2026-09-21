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
    builtImage({ tag: 'aaaaaaaaaaaa', id: 'sha-new', buildNamespace: 'alpha' }),
    builtImage({ tag: 'bbbbbbbbbbbb', id: 'sha-old', buildNamespace: 'alpha' }),
  ]);

  /** A deleter that records what it was asked to remove. */
  const recording = (removed: string[]) => ({
    delete: async (imageId: string) => {
      removed.push(imageId);
      return { deleted: imageId };
    },
  });

  it("leaves another workspace's build of the same source on the daemon", async () => {
    const removed: string[] = [];
    // A repo names the same files wherever it is built, so `beta`'s build of
    // TealFlow is a version of `alpha`'s entry too — but not `alpha`'s to destroy.
    daemon.value = daemonWith([
      builtImage({ tag: 'aaaaaaaaaaaa', id: 'sha-alpha', buildNamespace: 'alpha' }),
      builtImage({ tag: 'bbbbbbbbbbbb', id: 'sha-beta', buildNamespace: 'beta' }),
    ]);
    const scope = await adminScopeWith(recording(removed));
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    const result = await deleteImageCatalogEntry(
      { namespace: 'alpha', id: created.entry.id, withImages: true },
      scope,
    );

    expect(removed).toEqual(['mediforce-built:aaaaaaaaaaaa']);
    expect(result).toEqual({
      success: true,
      deletedImages: ['mediforce-built:aaaaaaaaaaaa'],
      keptImages: ['mediforce-built:bbbbbbbbbbbb'],
    });
    expect(await repo.getById('alpha', created.entry.id)).toBeNull();
  });

  it('takes an adopted image off the catalog but never off the daemon', async () => {
    const removed: string[] = [];
    // `postgres` was on the daemon before anyone catalogued it; **Existing
    // image** made it an entry, not this workspace's artifact. A live pin on
    // it does not block either, since nothing touches the image.
    daemon.value = daemonWith([
      builtImage({ repository: 'postgres', tag: '16', id: 'sha-pg', buildRepo: undefined }),
    ]);
    const scope = await adminScopeWith(recording(removed), [pinning('postgres:16')]);
    const created = await createImageCatalogEntry(
      {
        namespace: 'alpha',
        name: 'Postgres',
        intent: 'A database for steps that need one.',
        source: { kind: 'referenced', reference: 'postgres' },
      },
      scope,
    );

    const result = await deleteImageCatalogEntry(
      { namespace: 'alpha', id: created.entry.id, withImages: true },
      scope,
    );

    expect(removed).toEqual([]);
    expect(result).toEqual({ success: true, deletedImages: [], keptImages: ['postgres:16'] });
    expect(await repo.getById('alpha', created.entry.id)).toBeNull();
  });

  it('removes an image uploaded under the workspace handle', async () => {
    const removed: string[] = [];
    daemon.value = daemonWith([
      builtImage({ repository: 'alpha/agent', tag: '20260921', id: 'sha-up', buildRepo: undefined, buildNamespace: 'alpha' }),
    ]);
    const scope = await adminScopeWith(recording(removed));
    const created = await createImageCatalogEntry(
      {
        namespace: 'alpha',
        name: 'Agent',
        intent: 'The agent image this workspace uploads.',
        source: { kind: 'referenced', reference: 'alpha/agent' },
      },
      scope,
    );

    const result = await deleteImageCatalogEntry(
      { namespace: 'alpha', id: created.entry.id, withImages: true },
      scope,
    );

    expect(removed).toEqual(['alpha/agent:20260921']);
    expect(result).toEqual({ success: true, deletedImages: ['alpha/agent:20260921'], keptImages: [] });
  });

  it('removes the entry and audits the delete that removed it', async () => {
    const scope = adminScope();
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    const result = await deleteImageCatalogEntry(
      { namespace: 'alpha', id: created.entry.id },
      scope,
    );

    expect(result).toEqual({ success: true, deletedImages: [], keptImages: [] });
    expect(await repo.getById('alpha', created.entry.id)).toBeNull();
    const events = await auditRepo.getByEntity('imageCatalogEntry', created.entry.id);
    expect(events.filter((e) => e.action === 'image_catalog_entry.deleted')).toHaveLength(1);
  });

  it('is idempotent, and a no-op delete audits nothing', async () => {
    const scope = adminScope();

    await expect(
      deleteImageCatalogEntry({ namespace: 'alpha', id: 'nope-00000000' }, scope),
    ).resolves.toEqual({ success: true, deletedImages: [], keptImages: [] });
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

  it("keeps an image under the workspace handle that the workspace did not produce", async () => {
    const removed: string[] = [];
    // A name is not proof: `beta`'s build-mode step can tag `alpha/agent`, and
    // a pull carries no build label at all.
    daemon.value = daemonWith([
      builtImage({ repository: 'alpha/agent', tag: 'v2', id: 'sha-beta', buildRepo: undefined, buildNamespace: 'beta' }),
      builtImage({ repository: 'alpha/agent', tag: 'pulled', id: 'sha-pull', buildRepo: undefined }),
    ]);
    const scope = await adminScopeWith(recording(removed));
    const created = await createImageCatalogEntry(
      {
        namespace: 'alpha',
        name: 'Agent',
        intent: 'The agent image this workspace uploads.',
        source: { kind: 'referenced', reference: 'alpha/agent' },
      },
      scope,
    );

    const result = await deleteImageCatalogEntry(
      { namespace: 'alpha', id: created.entry.id, withImages: true },
      scope,
    );

    expect(removed).toEqual([]);
    expect(result.keptImages.sort()).toEqual(['alpha/agent:pulled', 'alpha/agent:v2']);
  });

  it('keeps an engine default on the shared daemon, and drops the row', async () => {
    const removed: string[] = [];
    // The image a `runtime: python` step falls back to, and a step that names
    // no image pins nothing — so the live-pin check has nothing to refuse on.
    daemon.value = daemonWith([builtImage({ repository: 'python', tag: '3.12-slim', id: 'sha-py', buildRepo: undefined })]);
    const scope = await adminScopeWith(recording(removed));
    const created = await createImageCatalogEntry(
      {
        namespace: 'alpha',
        name: 'Python runtime',
        intent: 'The image the engine runs a Python script step in when the step names none.',
        source: { kind: 'referenced', reference: 'python' },
      },
      scope,
    );

    const result = await deleteImageCatalogEntry(
      { namespace: 'alpha', id: created.entry.id, withImages: true },
      scope,
    );

    expect(removed).toEqual([]);
    expect(result).toEqual({ success: true, deletedImages: [], keptImages: ['python:3.12-slim'] });
    expect(await repo.getById('alpha', created.entry.id)).toBeNull();
  });

  it('keeps an engine default even for a workspace whose handle it starts with', async () => {
    const removed: string[] = [];
    daemon.value = daemonWith([builtImage({ repository: 'rocker/r-ver', tag: '4.4.1', id: 'sha-r', buildRepo: undefined })]);
    const scope = createTestScope({
      imageCatalogRepo: repo,
      auditRepo,
      dockerImages: recording(removed),
      caller: userCaller('u-admin', ['rocker'], new Map([['rocker', 'admin']])),
    });
    const created = await createImageCatalogEntry(
      {
        namespace: 'rocker',
        name: 'R runtime',
        intent: 'The image the engine runs an R script step in when the step names none.',
        source: { kind: 'referenced', reference: 'rocker/r-ver' },
      },
      scope,
    );

    const result = await deleteImageCatalogEntry(
      { namespace: 'rocker', id: created.entry.id, withImages: true },
      scope,
    );

    expect(removed).toEqual([]);
    expect(result.keptImages).toEqual(['rocker/r-ver:4.4.1']);
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

  it('destroys nothing when the pin is on the second of an entry\'s tags', async () => {
    const removed: string[] = [];
    daemon.value = TWO_VERSIONS;
    const scope = await adminScopeWith(
      {
        delete: async (imageId) => {
          removed.push(imageId);
          return { deleted: imageId };
        },
      },
      [pinning('mediforce-built:bbbbbbbbbbbb')],
    );
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    await expect(
      deleteImageCatalogEntry({ namespace: 'alpha', id: created.entry.id, withImages: true }, scope),
    ).rejects.toBeInstanceOf(ConflictError);

    // The refusal is weighed over every tag before the loop starts, so the
    // unpinned first tag is not already gone by the time the second refuses.
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
