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
import type { DockerInfoResponse } from '../../../contract/system';
import { EMPTY_DAEMON, TEALFLOW, builtImage, daemonWith } from './fixtures';

const daemon = vi.hoisted(() => ({ value: { available: false } as DockerInfoResponse }));
vi.mock('../../system/get-docker-info', () => ({ getDockerInfo: async () => daemon.value }));

const { createImageCatalogEntry } = await import('../create-entry');
const { listImageCatalogEntries } = await import('../list-entries');

describe('listImageCatalogEntries handler', () => {
  let repo: InMemoryImageCatalogRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    repo = new InMemoryImageCatalogRepository();
    auditRepo = new InMemoryAuditRepository();
    daemon.value = { available: false };
  });

  const scopeFor = (uid: string, namespaces: string[]) =>
    createTestScope({ imageCatalogRepo: repo, auditRepo, caller: userCaller(uid, namespaces) });

  it('is empty for a namespace nobody has catalogued anything in', async () => {
    const scope = scopeFor('u-member', ['alpha']);

    expect(await listImageCatalogEntries({ namespace: 'alpha' }, scope)).toEqual({ entries: [] });
  });

  it('lists an entry whose image is gone from the daemon, marked absent', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);
    daemon.value = EMPTY_DAEMON;

    const { entries } = await listImageCatalogEntries({ namespace: 'alpha' }, scope);

    expect(entries).toHaveLength(1);
    expect(entries[0].availability).toBe('absent');
    expect(entries[0].versions).toEqual([]);
  });

  it('annotates each entry with only the versions matching its own source', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);
    await createImageCatalogEntry(
      {
        namespace: 'alpha',
        name: 'Golden image',
        intent: 'The deployment agent-capable base image',
        source: { kind: 'referenced', reference: 'mediforce-golden-image' },
      },
      scope,
    );
    daemon.value = daemonWith([
      builtImage(),
      builtImage({ repository: 'mediforce-golden-image', tag: 'latest', id: 'sha-g', buildRepo: undefined, buildDockerfile: undefined }),
    ]);

    const { entries } = await listImageCatalogEntries({ namespace: 'alpha' }, scope);

    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
    expect(byName['TealFlow agent'].versions.map((v) => v.imageTag)).toEqual([
      'mediforce-built:aaaaaaaaaaaa',
    ]);
    expect(byName['Golden image'].versions.map((v) => v.imageTag)).toEqual([
      'mediforce-golden-image:latest',
    ]);
  });

  it('groups a derived entry under the entry it was built on, roots first', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    // Catalogued in the order that reads worst — the derivative first.
    await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);
    await createImageCatalogEntry(
      {
        namespace: 'alpha',
        name: 'Golden image',
        intent: 'The deployment agent-capable base image',
        source: { kind: 'referenced', reference: 'mediforce-golden-image' },
      },
      scope,
    );
    daemon.value = daemonWith([
      builtImage({ baseImageId: 'sha-g' }),
      builtImage({
        repository: 'mediforce-golden-image',
        tag: 'latest',
        id: 'sha-g',
        buildRepo: undefined,
        buildDockerfile: undefined,
      }),
    ]);

    const { entries } = await listImageCatalogEntries({ namespace: 'alpha' }, scope);

    expect(entries.map((entry) => entry.name)).toEqual(['Golden image', 'TealFlow agent']);
    expect(entries[0].baseEntryId).toBeNull();
    expect(entries[1].baseEntryId).toBe(entries[0].id);
    expect(entries[1].versions[0].lineage.base?.imageTag).toBe('mediforce-golden-image:latest');
  });

  it('keeps one namespace catalog out of another', async () => {
    const alpha = scopeFor('u-alpha', ['alpha']);
    const both = scopeFor('u-both', ['alpha', 'beta']);
    await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, alpha);
    await createImageCatalogEntry(
      {
        namespace: 'beta',
        ...TEALFLOW,
        source: { kind: 'built', repo: 'Appsilon/other', dockerfile: '' },
      },
      both,
    );

    const alphaEntries = await listImageCatalogEntries({ namespace: 'alpha' }, alpha);

    expect(alphaEntries.entries).toHaveLength(1);
    expect(alphaEntries.entries[0].name).toBe(TEALFLOW.name);
  });

  it('refuses a caller who is not a member of the namespace', async () => {
    const scope = scopeFor('u-outsider', ['beta']);

    await expect(
      listImageCatalogEntries({ namespace: 'alpha' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
