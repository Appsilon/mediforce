import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryImageCatalogRepository,
} from '@mediforce/platform-core/testing';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import type { DaemonImageListing } from '../../system/_docker';
import { TEALFLOW, TEALFLOW_REPO_URL, UNREACHABLE_DAEMON } from './fixtures';

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

  it('re-keys the entry when the source changes, leaving no row behind', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    // A second Dockerfile in the same repo is a different image, so it is a
    // different key — the id derives from the source (ADR-0022 decision 1).
    const { entry } = await updateImageCatalogEntry(
      {
        namespace: 'alpha',
        id: created.entry.id,
        source: { kind: 'built', repo: TEALFLOW.source.repo, dockerfile: 'container/Dockerfile.gpu' },
      },
      scope,
    );

    expect(entry.id).not.toBe(created.entry.id);
    expect(entry.source).toEqual({
      kind: 'built',
      repo: TEALFLOW_REPO_URL,
      dockerfile: 'container/Dockerfile.gpu',
    });
    // The fields nobody touched came across, so this is one entry moved rather
    // than a fresh one the caller has to describe again.
    expect(entry.name).toBe(TEALFLOW.name);
    expect(entry.intent).toBe(TEALFLOW.intent);
    // One row, not two: the old key is gone, so the catalog cannot show the
    // corrected entry beside the mistake it replaced.
    expect(await repo.getById('alpha', created.entry.id)).toBeNull();
    expect(await repo.list('alpha')).toHaveLength(1);
  });

  it('keeps the id when the new source is the same key spelled differently', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    // `Appsilon/tealflow` canonicalises to exactly this, so nothing moved and
    // the entry must not be deleted and re-created underneath the caller.
    const { entry } = await updateImageCatalogEntry(
      {
        namespace: 'alpha',
        id: created.entry.id,
        source: { kind: 'built', repo: TEALFLOW_REPO_URL, dockerfile: TEALFLOW.source.dockerfile },
      },
      scope,
    );

    expect(entry.id).toBe(created.entry.id);
    expect(await repo.list('alpha')).toHaveLength(1);
  });

  it('stores a new build context in place, since the context is not in the key', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    const { entry } = await updateImageCatalogEntry(
      {
        namespace: 'alpha',
        id: created.entry.id,
        source: { ...TEALFLOW.source, context: '.' },
      },
      scope,
    );

    expect(entry.id).toBe(created.entry.id);
    const stored = await repo.getById('alpha', created.entry.id);
    expect(stored?.source).toEqual({
      kind: 'built',
      repo: TEALFLOW_REPO_URL,
      dockerfile: 'container/Dockerfile',
      context: '.',
    });
  });

  it('refuses to re-key onto a source another entry already describes', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    const tealflow = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);
    const golden = await createImageCatalogEntry(
      {
        namespace: 'alpha',
        name: 'Golden image',
        intent: 'The image every agent step runs in unless a workflow says otherwise',
        source: { kind: 'referenced', reference: 'mediforce-golden-image' },
      },
      scope,
    );

    // Silently upserting would overwrite the golden entry's own sentence with
    // TealFlow's and delete the row the caller was editing.
    await expect(
      updateImageCatalogEntry(
        {
          namespace: 'alpha',
          id: tealflow.entry.id,
          source: { kind: 'referenced', reference: 'mediforce-golden-image' },
        },
        scope,
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(await repo.getById('alpha', tealflow.entry.id)).not.toBeNull();
    expect((await repo.getById('alpha', golden.entry.id))?.name).toBe('Golden image');
  });

  it('audits a re-key against both ids, so neither history dead-ends', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    const created = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    const { entry } = await updateImageCatalogEntry(
      {
        namespace: 'alpha',
        id: created.entry.id,
        source: { kind: 'built', repo: 'Appsilon/tealflow-gpu', dockerfile: '' },
      },
      scope,
    );

    const onNew = await auditRepo.getByEntity('imageCatalogEntry', entry.id);
    expect(onNew.some((event) => event.action === 'image_catalog_entry.updated')).toBe(true);
    // The old id is what a reader auditing the row they remember searches for,
    // and a re-key is the one update that leaves that id with no row.
    const onOld = await auditRepo.getByEntity('imageCatalogEntry', created.entry.id);
    expect(onOld.some((event) => event.action === 'image_catalog_entry.rekeyed')).toBe(true);
  });
});
