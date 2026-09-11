import { describe, it, expect, beforeEach, vi } from 'vitest';
import { deriveBuildTag } from '@mediforce/agent-runtime';
import {
  InMemoryAuditRepository,
  InMemoryImageCatalogRepository,
} from '@mediforce/platform-core/testing';
import { ForbiddenError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import type { BuildImageRequest } from '@mediforce/platform-core';

const builds = vi.hoisted(() => ({
  calls: [] as BuildImageRequest[],
  fail: null as string | null,
}));
vi.mock('../../system/_docker', () => ({
  buildImage: async (request: BuildImageRequest) => {
    builds.calls.push(request);
    if (builds.fail !== null) throw new Error(builds.fail);
  },
}));

const { buildImageCatalogVersion } = await import('../build-version');

describe('buildImageCatalogVersion handler', () => {
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    builds.calls = [];
    builds.fail = null;
    auditRepo = new InMemoryAuditRepository();
  });

  const scopeFor = (uid: string, namespaces: string[]) =>
    createTestScope({
      imageCatalogRepo: new InMemoryImageCatalogRepository(),
      auditRepo,
      caller: userCaller(uid, namespaces),
    });

  const input = {
    namespace: 'alpha',
    repo: 'Appsilon/tealflow',
    commit: 'bf0353b123bee142100ae5605ec15ad7605ceb4f',
    dockerfile: 'container/Dockerfile',
  };

  it('builds under the tag a build-mode step pinning the same commit resolves to', async () => {
    const result = await buildImageCatalogVersion(input, scopeFor('u-member', ['alpha']));

    // Not a fresh convention: the tag is what `deriveBuildTag` already mints,
    // so the step finds this image cached rather than rebuilding it.
    expect(result.imageTag).toBe(
      deriveBuildTag('git@github.com:Appsilon/tealflow.git', input.commit, 'container/Dockerfile'),
    );
    expect(builds.calls[0]?.image).toBe(result.imageTag);
    expect(builds.calls[0]?.namespace).toBe('alpha');
  });

  it('passes the Dockerfile through as the entry keys it, empty included', async () => {
    await buildImageCatalogVersion(
      { ...input, dockerfile: '' },
      scopeFor('u-member', ['alpha']),
    );

    // The empty string is a value: labelling a resolved `Dockerfile` default
    // would stop the image matching the entry keyed on the empty one.
    expect(builds.calls[0]?.dockerfile).toBe('');
  });

  it('builds from a named context under the tag a step naming it resolves to', async () => {
    const result = await buildImageCatalogVersion(
      { ...input, context: '.' },
      scopeFor('u-member', ['alpha']),
    );

    expect(result.imageTag).toBe(
      deriveBuildTag('git@github.com:Appsilon/tealflow.git', input.commit, 'container/Dockerfile', '.'),
    );
    expect(builds.calls[0]?.context).toBe('.');
    // The same Dockerfile, so the same entry as a build with no context.
    const narrow = await buildImageCatalogVersion(input, scopeFor('u-member', ['alpha']));
    expect(result.entryId).toBe(narrow.entryId);
    expect(builds.calls[1]?.context).toBeUndefined();
  });

  it('reports a failed build instead of returning a tag for an image that is not there', async () => {
    builds.fail = 'no such Dockerfile';

    await expect(
      buildImageCatalogVersion(input, scopeFor('u-member', ['alpha'])),
    ).rejects.toThrow('no such Dockerfile');
  });

  it('lets any workspace member build, and refuses a non-member', async () => {
    await expect(
      buildImageCatalogVersion(input, scopeFor('u-member', ['alpha'])),
    ).resolves.toBeDefined();

    await expect(
      buildImageCatalogVersion(input, scopeFor('u-outsider', ['beta'])),
    ).rejects.toThrow(ForbiddenError);
  });

  it('audits the build against the entry it belongs to', async () => {
    const result = await buildImageCatalogVersion(input, scopeFor('u-member', ['alpha']));

    const events = await auditRepo.getByEntity('imageCatalogEntry', result.entryId);
    expect(events.map((event) => event.action)).toContain('image_catalog_entry.version_built');
  });
});
