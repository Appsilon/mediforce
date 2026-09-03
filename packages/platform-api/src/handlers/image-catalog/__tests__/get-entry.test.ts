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
import type { DockerInfoResponse } from '../../../contract/system';
import { EMPTY_DAEMON, TEALFLOW, builtImage, daemonWith } from './fixtures';

const daemon = vi.hoisted(() => ({ value: { available: false } as DockerInfoResponse }));
vi.mock('../../system/get-docker-info', () => ({ getDockerInfo: async () => daemon.value }));

const { createImageCatalogEntry } = await import('../create-entry');
const { getImageCatalogEntry } = await import('../get-entry');

describe('getImageCatalogEntry handler', () => {
  let repo: InMemoryImageCatalogRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    repo = new InMemoryImageCatalogRepository();
    auditRepo = new InMemoryAuditRepository();
    daemon.value = { available: false };
  });

  const scopeFor = (uid: string, namespaces: string[]) =>
    createTestScope({ imageCatalogRepo: repo, auditRepo, caller: userCaller(uid, namespaces) });

  async function seedEntry() {
    const scope = scopeFor('u-member', ['alpha']);
    const { entry } = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);
    return { scope, id: entry.id };
  }

  it('404s an id nobody catalogued', async () => {
    const scope = scopeFor('u-member', ['alpha']);

    await expect(
      getImageCatalogEntry({ namespace: 'alpha', id: 'nope-00000000' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns the entry with its versions when the daemon holds the image', async () => {
    const { scope, id } = await seedEntry();
    daemon.value = daemonWith([builtImage({ tag: 'newer' }), builtImage({ tag: 'older', id: 'sha-2' })]);

    const { entry } = await getImageCatalogEntry({ namespace: 'alpha', id }, scope);

    expect(entry.availability).toBe('present');
    expect(entry.versions.map((v) => v.imageTag)).toEqual([
      'mediforce-built:newer',
      'mediforce-built:older',
    ]);
  });

  it('names a base that is another entry — resolved against the whole catalog, not this row', async () => {
    const { scope, id } = await seedEntry();
    const { entry: golden } = await createImageCatalogEntry(
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

    const { entry } = await getImageCatalogEntry({ namespace: 'alpha', id }, scope);

    expect(entry.baseEntryId).toBe(golden.id);
    expect(entry.versions[0].lineage.base?.imageTag).toBe('mediforce-golden-image:latest');
  });

  it('still returns an entry whose image is gone from the daemon, marked absent', async () => {
    const { scope, id } = await seedEntry();
    daemon.value = EMPTY_DAEMON;

    const { entry } = await getImageCatalogEntry({ namespace: 'alpha', id }, scope);

    expect(entry.availability).toBe('absent');
    expect(entry.versions).toEqual([]);
  });

  it('degrades to unknown rather than failing when the daemon is unreachable', async () => {
    const { scope, id } = await seedEntry();

    const { entry } = await getImageCatalogEntry({ namespace: 'alpha', id }, scope);

    expect(entry.availability).toBe('unknown');
  });

  it('refuses a caller who is not a member of the namespace', async () => {
    const { id } = await seedEntry();
    const outsider = scopeFor('u-outsider', ['beta']);

    await expect(
      getImageCatalogEntry({ namespace: 'alpha', id }, outsider),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
