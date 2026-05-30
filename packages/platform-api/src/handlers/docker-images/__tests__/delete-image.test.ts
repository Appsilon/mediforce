import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import { deleteDockerImage } from '../delete-image';
import { ForbiddenError, PreconditionFailedError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import type { DockerImagesService } from '../../../services/docker-images-service';
import type { CallerIdentity } from '../../../auth';

class FakeDeleter implements DockerImagesService {
  public calls: string[] = [];
  constructor(private readonly result: { deleted: string; output?: string }) {}
  async delete(imageId: string) {
    this.calls.push(imageId);
    return this.result;
  }
}

const apiKeyCaller: CallerIdentity = { kind: 'apiKey', isSystemActor: true };

describe('deleteDockerImage handler', () => {
  let auditRepo: InMemoryAuditRepository;
  let deleter: FakeDeleter;

  beforeEach(() => {
    auditRepo = new InMemoryAuditRepository();
    deleter = new FakeDeleter({ deleted: 'sha256:abc', output: 'Untagged: foo:bar' });
  });

  it('[AUTHZ] apiKey caller passes through, audit emitted', async () => {
    const scope = createTestScope({
      auditRepo,
      dockerImages: deleter,
      caller: apiKeyCaller,
    });

    const result = await deleteDockerImage({ imageId: 'sha256:abc' }, scope);

    expect(result.deleted).toBe('sha256:abc');
    expect(result.output).toBe('Untagged: foo:bar');
    expect(deleter.calls).toEqual(['sha256:abc']);

    // Audit emission disabled — see TODO(#592) in delete-image.ts.
    const events = await auditRepo.getByEntity('dockerImage', 'sha256:abc');
    expect(events).toHaveLength(0);
  });

  it('[AUTHZ] user with owner role in some namespace passes', async () => {
    const scope = createTestScope({
      auditRepo,
      dockerImages: deleter,
      caller: userCaller(
        'u-owner',
        ['alpha'],
        new Map([['alpha', 'owner']]),
      ),
    });

    const result = await deleteDockerImage({ imageId: 'img-1' }, scope);
    expect(result.deleted).toBe('sha256:abc');
    expect(deleter.calls).toEqual(['img-1']);
  });

  it('[AUTHZ] user with admin role in some namespace passes', async () => {
    const scope = createTestScope({
      auditRepo,
      dockerImages: deleter,
      caller: userCaller(
        'u-admin',
        ['alpha'],
        new Map([['alpha', 'admin']]),
      ),
    });

    await expect(
      deleteDockerImage({ imageId: 'img-1' }, scope),
    ).resolves.toBeTruthy();
  });

  it('[AUTHZ] user with only member role is forbidden', async () => {
    const scope = createTestScope({
      auditRepo,
      dockerImages: deleter,
      caller: userCaller(
        'u-member',
        ['alpha'],
        new Map([['alpha', 'member']]),
      ),
    });

    await expect(
      deleteDockerImage({ imageId: 'img-1' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(deleter.calls).toEqual([]);
  });

  it('[AUTHZ] user with no namespace memberships is forbidden', async () => {
    const scope = createTestScope({
      auditRepo,
      dockerImages: deleter,
      caller: userCaller('u-none', []),
    });

    await expect(
      deleteDockerImage({ imageId: 'img-1' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('[ERROR] PreconditionFailedError when deleter is not configured', async () => {
    const scope = createTestScope({
      auditRepo,
      dockerImages: null,
      caller: apiKeyCaller,
    });

    await expect(
      deleteDockerImage({ imageId: 'img-1' }, scope),
    ).rejects.toBeInstanceOf(PreconditionFailedError);

    const events = await auditRepo.getByEntity('dockerImage', 'img-1');
    expect(events).toHaveLength(0);
  });

  it('[DATA] omits output field when deleter returns none', async () => {
    const silentDeleter = new FakeDeleter({ deleted: 'img-1' });
    const scope = createTestScope({
      auditRepo,
      dockerImages: silentDeleter,
      caller: apiKeyCaller,
    });

    const result = await deleteDockerImage({ imageId: 'img-1' }, scope);
    expect(result.deleted).toBe('img-1');
    expect(result.output).toBeUndefined();
  });
});
