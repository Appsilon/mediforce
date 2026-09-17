import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryImageCatalogRepository,
  InMemoryNamespaceRepository,
} from '@mediforce/platform-core/testing';
import {
  ConflictError,
  ForbiddenError,
  PreconditionFailedError,
  ValidationError,
} from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import type { DaemonImageListing } from '../../system/_docker';
import { EMPTY_DAEMON, UNREACHABLE_DAEMON, daemonWith } from './fixtures';

const docker = vi.hoisted(() => ({
  daemon: { available: false, images: [] } as DaemonImageListing,
  pulls: [] as string[],
  fail: null as Error | null,
}));
vi.mock('../../system/_docker', () => ({
  fetchDaemonImages: async () => docker.daemon,
  probeImageCapabilities: async () => ({ status: 'unknown' }),
  fetchImageHistory: async () => null,
  pullImage: async ({ image }: { image: string }) => {
    if (docker.fail !== null) throw docker.fail;
    docker.pulls.push(image);
  },
}));

const { pullImageCatalogVersion } = await import('../pull-version');

describe('pullImageCatalogVersion handler', () => {
  let repo: InMemoryImageCatalogRepository;
  let auditRepo: InMemoryAuditRepository;
  let namespaceRepo: InMemoryNamespaceRepository;

  beforeEach(async () => {
    repo = new InMemoryImageCatalogRepository();
    auditRepo = new InMemoryAuditRepository();
    namespaceRepo = new InMemoryNamespaceRepository();
    for (const handle of ['alpha', 'beta']) {
      await namespaceRepo.createNamespaceWithOwner({
        namespace: { handle, type: 'organization', displayName: handle, createdAt: new Date().toISOString() },
        ownerMember: { uid: `u-${handle}-owner`, role: 'owner', joinedAt: new Date().toISOString() },
      });
    }
    docker.daemon = EMPTY_DAEMON;
    docker.pulls = [];
    docker.fail = null;
  });

  const scopeFor = (uid: string, namespaces: string[]) =>
    createTestScope({ imageCatalogRepo: repo, auditRepo, namespaceRepo, caller: userCaller(uid, namespaces) });

  const first = {
    namespace: 'alpha',
    reference: 'ghcr.io/acme/sdtm-agent',
    tag: 'v1.0.0',
    intent: 'Maps raw EDC exports to SDTM domains',
  };

  it('pulls the reference at the tag, and catalogues a referenced entry in the same call', async () => {
    const result = await pullImageCatalogVersion(first, scopeFor('u-member', ['alpha']));

    expect(docker.pulls).toEqual(['ghcr.io/acme/sdtm-agent:v1.0.0']);
    expect(result.imageTag).toBe('ghcr.io/acme/sdtm-agent:v1.0.0');
    expect(await repo.getById('alpha', result.entryId)).toMatchObject({
      name: 'sdtm-agent',
      intent: first.intent,
      source: { kind: 'referenced', reference: 'ghcr.io/acme/sdtm-agent' },
    });
  });

  it('pulls "latest" when no tag is given', async () => {
    const { imageTag } = await pullImageCatalogVersion(
      { ...first, tag: undefined },
      scopeFor('u-member', ['alpha']),
    );

    expect(imageTag).toBe('ghcr.io/acme/sdtm-agent:latest');
  });

  it('keys a Docker Hub image on the name the daemon lists it under', async () => {
    const { imageTag, entryId } = await pullImageCatalogVersion(
      { ...first, reference: 'docker.io/library/python', tag: '3.12-slim' },
      scopeFor('u-member', ['alpha']),
    );

    expect(docker.pulls).toEqual(['python:3.12-slim']);
    expect(imageTag).toBe('python:3.12-slim');
    expect((await repo.getById('alpha', entryId))?.source).toEqual({ kind: 'referenced', reference: 'python' });
  });

  it('drops a bare library/ as the daemon does, so the entry finds its versions', async () => {
    const { imageTag } = await pullImageCatalogVersion(
      { ...first, reference: 'library/python', tag: '3.12-slim' },
      scopeFor('u-member', ['alpha']),
    );

    expect(imageTag).toBe('python:3.12-slim');
  });

  it('lands a second tag in the entry the first pull created, without asking again', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    const { entryId } = await pullImageCatalogVersion(first, scope);

    const second = await pullImageCatalogVersion(
      { namespace: 'alpha', reference: first.reference, tag: 'v1.1.0' },
      scope,
    );

    expect(second.entryId).toBe(entryId);
    expect(await repo.list('alpha')).toHaveLength(1);
  });

  it('never lets a later pull rewrite the entry', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    await pullImageCatalogVersion(first, scope);

    await expect(
      pullImageCatalogVersion({ ...first, tag: 'v2', intent: 'Something else entirely' }, scope),
    ).rejects.toThrow(/only adds a version/);
    expect(docker.pulls).toHaveLength(1);
  });

  it('needs an intent the first time a reference is pulled, before pulling anything', async () => {
    await expect(
      pullImageCatalogVersion({ ...first, intent: undefined }, scopeFor('u-member', ['alpha'])),
    ).rejects.toThrow(ValidationError);
    expect(docker.pulls).toHaveLength(0);
  });

  it('refuses a tag already on the daemon rather than replacing what a step may pin', async () => {
    docker.daemon = daemonWith([
      { repository: 'ghcr.io/acme/sdtm-agent', tag: 'v1.0.0', id: 'sha-old', size: '5MB', created: '1 day ago' },
    ]);

    await expect(pullImageCatalogVersion(first, scopeFor('u-member', ['alpha']))).rejects.toThrow(ConflictError);
    expect(docker.pulls).toHaveLength(0);
  });

  it("refuses a name another workspace owns, so a registry image cannot pose as that workspace's version", async () => {
    await expect(
      pullImageCatalogVersion({ ...first, reference: 'beta/agent' }, scopeFor('u-member', ['alpha'])),
    ).rejects.toThrow(/belongs to workspace "beta"/);
    expect(docker.pulls).toHaveLength(0);
  });

  it('allows a name under its own workspace, and a first segment no workspace has', async () => {
    const scope = scopeFor('u-member', ['alpha']);

    await pullImageCatalogVersion({ ...first, reference: 'alpha/agent' }, scope);
    await pullImageCatalogVersion({ ...first, reference: 'rocker/r-ver', tag: '4.4.1' }, scope);

    expect(docker.pulls).toEqual(['alpha/agent:v1.0.0', 'rocker/r-ver:4.4.1']);
  });

  it('refuses to pull when the daemon cannot say whether the tag is taken', async () => {
    docker.daemon = UNREACHABLE_DAEMON;

    await expect(pullImageCatalogVersion(first, scopeFor('u-member', ['alpha']))).rejects.toThrow(
      PreconditionFailedError,
    );
    expect(docker.pulls).toHaveLength(0);
  });

  it('reports a failed pull and catalogues nothing', async () => {
    docker.fail = new Error('Error response from daemon: manifest unknown');

    await expect(pullImageCatalogVersion(first, scopeFor('u-member', ['alpha']))).rejects.toThrow(
      'manifest unknown',
    );
    expect(await repo.list('alpha')).toHaveLength(0);
  });

  it('refuses a non-member', async () => {
    await expect(pullImageCatalogVersion(first, scopeFor('u-outsider', ['beta']))).rejects.toThrow(
      ForbiddenError,
    );
    expect(docker.pulls).toHaveLength(0);
  });

  it("audits the first pull as the entry's creation, and every pull as a version", async () => {
    const scope = scopeFor('u-member', ['alpha']);
    const { entryId } = await pullImageCatalogVersion(first, scope);
    await pullImageCatalogVersion({ ...first, tag: 'v2', intent: undefined }, scope);

    const events = await auditRepo.getByEntity('imageCatalogEntry', entryId);
    expect(events.map((event) => event.action).sort()).toEqual([
      'image_catalog_entry.created',
      'image_catalog_entry.version_pulled',
      'image_catalog_entry.version_pulled',
    ]);
  });
});
