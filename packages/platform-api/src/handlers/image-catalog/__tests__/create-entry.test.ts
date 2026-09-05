import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryImageCatalogRepository,
} from '@mediforce/platform-core/testing';
import { ForbiddenError, HandlerError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import type { DockerInfoResponse } from '../../../contract/system';
import { TEALFLOW, TEALFLOW_REPO_URL } from './fixtures';

// The handlers reconcile against the daemon on every read; stubbing that one
// read keeps these tests hermetic. Reconciliation itself is covered by
// `_versions.test.ts`, at the level where it is a pure function.
const daemon = vi.hoisted(() => ({ value: { available: false } as DockerInfoResponse }));
vi.mock('../../system/get-docker-info', () => ({ getDockerInfo: async () => daemon.value }));

const { createImageCatalogEntry } = await import('../create-entry');

describe('createImageCatalogEntry handler', () => {
  let repo: InMemoryImageCatalogRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    repo = new InMemoryImageCatalogRepository();
    auditRepo = new InMemoryAuditRepository();
    daemon.value = { available: false };
  });

  const scopeFor = (uid: string, namespaces: string[]) =>
    createTestScope({ imageCatalogRepo: repo, auditRepo, caller: userCaller(uid, namespaces) });

  it('creates an entry for a plain workspace member and writes audit', async () => {
    const scope = scopeFor('u-member', ['alpha']);

    const { entry } = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    expect(entry.id).toMatch(/^tealflow-[0-9a-f]{8}$/);
    expect(entry.intent).toBe(TEALFLOW.intent);
    const events = await auditRepo.getByEntity('imageCatalogEntry', entry.id);
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('image_catalog_entry.created');
    expect(events[0].actorId).toBe('u-member');
  });

  it('stores the repo in the form the build labels carry', async () => {
    const scope = scopeFor('u-member', ['alpha']);

    const { entry } = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    expect(entry.source).toEqual({
      kind: 'built',
      repo: TEALFLOW_REPO_URL,
      dockerfile: 'container/Dockerfile',
    });
  });

  it('refuses a second entry for a source already catalogued under another spelling', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    const first = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);

    const second = createImageCatalogEntry(
      {
        namespace: 'alpha',
        ...TEALFLOW,
        source: { kind: 'built', repo: TEALFLOW_REPO_URL, dockerfile: 'container/Dockerfile' },
      },
      scope,
    );

    await expect(second).rejects.toMatchObject({ code: 'conflict' });
    expect((await repo.list('alpha')).map((e) => e.id)).toEqual([first.entry.id]);
  });

  it('rejects an empty intent in the contract, not just the form', async () => {
    const scope = scopeFor('u-member', ['alpha']);

    await expect(
      createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW, intent: '' }, scope),
    ).rejects.toBeInstanceOf(HandlerError);
    expect(await repo.list('alpha')).toEqual([]);
  });

  it('catalogues a referenced source with a declared source reference', async () => {
    const scope = scopeFor('u-member', ['alpha']);

    const { entry } = await createImageCatalogEntry(
      {
        namespace: 'alpha',
        name: 'Golden image',
        intent: 'The deployment agent-capable base image',
        source: { kind: 'referenced', reference: 'mediforce-golden-image' },
        declaredSource: { repo: 'Appsilon/mediforce', commit: 'abc1234' },
      },
      scope,
    );

    expect(entry.source).toEqual({ kind: 'referenced', reference: 'mediforce-golden-image' });
    expect(entry.declaredSource).toEqual({ repo: 'Appsilon/mediforce', commit: 'abc1234' });
  });

  it('refuses a caller who is not a member of the namespace', async () => {
    const scope = scopeFor('u-outsider', ['beta']);

    await expect(
      createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await repo.list('alpha')).toEqual([]);
  });
});
