import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BUILD_CONTEXT_MAX_BYTES,
  packBuildContextArchive,
  type BuildUploadedImageRequest,
} from '@mediforce/platform-core';
import {
  InMemoryAuditRepository,
  InMemoryImageCatalogRepository,
} from '@mediforce/platform-core/testing';
import {
  ConflictError,
  ForbiddenError,
  PayloadTooLargeError,
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
  builds: [] as Array<{ request: BuildUploadedImageRequest; archive: Uint8Array }>,
  fail: null as Error | null,
  duringBuild: null as (() => Promise<void>) | null,
}));
vi.mock('../../system/_docker', () => ({
  fetchDaemonImages: async () => docker.daemon,
  probeImageCapabilities: async () => ({ status: 'unknown' }),
  fetchImageHistory: async () => null,
  buildUploadedImage: async (request: BuildUploadedImageRequest, archive: Uint8Array) => {
    if (docker.fail !== null) throw docker.fail;
    await docker.duringBuild?.();
    docker.builds.push({ request, archive });
  },
}));

const { uploadImageCatalogVersion } = await import('../upload-version');

const encoder = new TextEncoder();
const context = packBuildContextArchive([
  { kind: 'file', path: 'Dockerfile', content: encoder.encode('FROM alpine\n') },
]);

describe('uploadImageCatalogVersion handler', () => {
  let repo: InMemoryImageCatalogRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    repo = new InMemoryImageCatalogRepository();
    auditRepo = new InMemoryAuditRepository();
    docker.daemon = EMPTY_DAEMON;
    docker.builds = [];
    docker.fail = null;
    docker.duringBuild = null;
  });

  const scopeFor = (uid: string, namespaces: string[]) =>
    createTestScope({ imageCatalogRepo: repo, auditRepo, caller: userCaller(uid, namespaces) });

  const first = {
    namespace: 'alpha',
    reference: 'alpha/agent',
    tag: 'v1',
    dockerfile: '',
    intent: 'Runs the ADaM checks we have no repo for',
    context,
  };

  it('builds under the reference and tag, and catalogues a referenced entry in the same call', async () => {
    const result = await uploadImageCatalogVersion(
      { ...first, declaredSource: { repo: 'https://gitlab.internal/acme/agent', commit: 'deadbeef' } },
      scopeFor('u-member', ['alpha']),
    );

    expect(result.imageTag).toBe('alpha/agent:v1');
    expect(docker.builds[0]?.request).toEqual({ image: 'alpha/agent:v1', dockerfile: '', namespace: 'alpha' });
    expect(docker.builds[0]?.archive).toBe(context);

    // Referenced, not built: the platform keeps none of the inputs, so its
    // versions are tags and the only provenance is what the uploader declared.
    const stored = await repo.getById('alpha', result.entryId);
    expect(stored).toMatchObject({
      name: 'agent',
      intent: first.intent,
      source: { kind: 'referenced', reference: 'alpha/agent' },
      declaredSource: { repo: 'https://gitlab.internal/acme/agent', commit: 'deadbeef' },
    });
  });

  it('tags a version with the upload time when no tag is given', async () => {
    const { imageTag } = await uploadImageCatalogVersion(
      { ...first, tag: undefined },
      scopeFor('u-member', ['alpha']),
    );

    expect(imageTag).toMatch(/^alpha\/agent:\d{8}-\d{6}$/);
  });

  it('lands a second upload in the entry the first one created, without asking again', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    const { entryId } = await uploadImageCatalogVersion(first, scope);

    const second = await uploadImageCatalogVersion(
      { namespace: 'alpha', reference: 'alpha/agent', tag: 'v2', dockerfile: '', context },
      scope,
    );

    expect(second.entryId).toBe(entryId);
    expect((await repo.getById('alpha', entryId))?.intent).toBe(first.intent);
    expect(await repo.list('alpha')).toHaveLength(1);
  });

  it('never lets a later upload rewrite the entry, and accepts its fields repeated unchanged', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    const { entryId } = await uploadImageCatalogVersion(
      { ...first, declaredSource: { commit: 'deadbeef' } },
      scope,
    );

    for (const change of [
      { intent: 'Something else entirely' },
      { name: 'Renamed' },
      { declaredSource: { commit: 'cafef00d' } },
    ]) {
      await expect(uploadImageCatalogVersion({ ...first, tag: 'v2', ...change }, scope)).rejects.toThrow(
        /only adds a version/,
      );
    }
    expect(docker.builds).toHaveLength(1);

    await uploadImageCatalogVersion({ ...first, tag: 'v2', declaredSource: { commit: 'deadbeef' } }, scope);
    expect(await repo.getById('alpha', entryId)).toMatchObject({
      name: 'agent',
      intent: first.intent,
      declaredSource: { commit: 'deadbeef' },
    });
  });

  it('refuses to drop its fields silently when another first upload catalogued the reference while it built', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    docker.duringBuild = async () => {
      docker.duringBuild = null;
      await uploadImageCatalogVersion({ ...first, tag: 'v0', intent: 'Catalogued by the other upload' }, scope);
    };

    await expect(uploadImageCatalogVersion(first, scope)).rejects.toThrow(
      /"alpha\/agent:v1" was built.*intent differ/,
    );
    const [entry] = await repo.list('alpha');
    expect(entry?.intent).toBe('Catalogued by the other upload');
  });

  it('lands in the entry another first upload created while it built, when the fields agree', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    docker.duringBuild = async () => {
      docker.duringBuild = null;
      await uploadImageCatalogVersion({ ...first, tag: 'v0' }, scope);
    };

    const { imageTag } = await uploadImageCatalogVersion(first, scope);

    expect(imageTag).toBe('alpha/agent:v1');
    expect(await repo.list('alpha')).toHaveLength(1);
  });

  it('needs an intent the first time a reference is uploaded, before building anything', async () => {
    await expect(
      uploadImageCatalogVersion({ ...first, intent: undefined }, scopeFor('u-member', ['alpha'])),
    ).rejects.toThrow(ValidationError);
    expect(docker.builds).toHaveLength(0);
  });

  it('refuses a tag already on the daemon rather than replacing what a step may pin', async () => {
    docker.daemon = daemonWith([
      { repository: 'alpha/agent', tag: 'v1', id: 'sha-old', size: '5MB', created: '1 day ago' },
    ]);

    await expect(
      uploadImageCatalogVersion(first, scopeFor('u-member', ['alpha'])),
    ).rejects.toThrow(ConflictError);
    expect(docker.builds).toHaveLength(0);
  });

  it('refuses to build when the daemon cannot say whether the tag is taken', async () => {
    docker.daemon = UNREACHABLE_DAEMON;

    await expect(
      uploadImageCatalogVersion(first, scopeFor('u-member', ['alpha'])),
    ).rejects.toThrow(PreconditionFailedError);
    expect(docker.builds).toHaveLength(0);
  });

  it('refuses an oversized context as too large, and a malformed one as invalid, before the daemon', async () => {
    const scope = scopeFor('u-member', ['alpha']);

    await expect(
      uploadImageCatalogVersion({ ...first, context: new Uint8Array(BUILD_CONTEXT_MAX_BYTES + 1) }, scope),
    ).rejects.toThrow(PayloadTooLargeError);
    await expect(
      uploadImageCatalogVersion({ ...first, dockerfile: 'container/Dockerfile' }, scope),
    ).rejects.toThrow(/No Dockerfile at "container\/Dockerfile"/);
    expect(docker.builds).toHaveLength(0);
  });

  it('reports a failed build and catalogues nothing', async () => {
    docker.fail = new Error('ERROR: failed to solve: process "/bin/sh -c false" did not complete');

    await expect(
      uploadImageCatalogVersion(first, scopeFor('u-member', ['alpha'])),
    ).rejects.toThrow('failed to solve');
    expect(await repo.list('alpha')).toHaveLength(0);
  });

  it('lets any workspace member upload, and refuses a non-member', async () => {
    await expect(
      uploadImageCatalogVersion(first, scopeFor('u-outsider', ['beta'])),
    ).rejects.toThrow(ForbiddenError);
    expect(docker.builds).toHaveLength(0);
  });

  it('passes on a tag the worker found taken once built as a conflict, and catalogues nothing', async () => {
    docker.fail = new ConflictError('"alpha/agent:v1" is already on the daemon.');

    await expect(
      uploadImageCatalogVersion(first, scopeFor('u-member', ['alpha'])),
    ).rejects.toThrow(ConflictError);
    expect(await repo.list('alpha')).toHaveLength(0);
  });

  it('audits the first upload as the entry\'s creation, and every upload as a version', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    const { entryId } = await uploadImageCatalogVersion(first, scope);
    await uploadImageCatalogVersion({ ...first, tag: 'v2', intent: undefined }, scope);

    const events = await auditRepo.getByEntity('imageCatalogEntry', entryId);
    expect(events.map((event) => event.action).sort()).toEqual([
      'image_catalog_entry.created',
      'image_catalog_entry.version_uploaded',
      'image_catalog_entry.version_uploaded',
    ]);
  });
});
