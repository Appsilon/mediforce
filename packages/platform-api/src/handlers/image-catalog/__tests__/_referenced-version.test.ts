import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryImageCatalogRepository,
} from '@mediforce/platform-core/testing';
import {
  ConflictError,
  HandlerError,
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
}));
vi.mock('../../system/_docker', () => ({
  fetchDaemonImages: async () => docker.daemon,
  probeImageCapabilities: async () => ({ status: 'unknown' }),
  fetchImageHistory: async () => null,
}));

const { addReferencedVersion } = await import('../_referenced-version');

describe('addReferencedVersion', () => {
  let repo: InMemoryImageCatalogRepository;
  let auditRepo: InMemoryAuditRepository;
  let produced: string[];

  beforeEach(() => {
    repo = new InMemoryImageCatalogRepository();
    auditRepo = new InMemoryAuditRepository();
    docker.daemon = EMPTY_DAEMON;
    produced = [];
  });

  const scope = () =>
    createTestScope({ imageCatalogRepo: repo, auditRepo, caller: userCaller('u-member', ['alpha']) });

  const request = {
    namespace: 'alpha',
    reference: 'ghcr.io/acme/agent',
    tag: 'v1',
    intent: 'Runs the SDTM mapping agent',
  };

  const options = (act: 'upload' | 'pull', produce?: (image: string) => Promise<void>) => ({
    act,
    produce:
      produce ??
      (async (image: string) => {
        produced.push(image);
      }),
    versionAudit: (image: string) => ({
      action: `image_catalog_entry.version_${act}`,
      description: `version ${image}`,
      inputSnapshot: { image },
      basis: 'test',
    }),
  });

  it('produces reference:tag, creates the entry named after the last path segment, and audits both', async () => {
    const result = await addReferencedVersion(request, scope(), options('pull'));

    expect(produced).toEqual(['ghcr.io/acme/agent:v1']);
    expect(result).toEqual({ imageTag: 'ghcr.io/acme/agent:v1', entryId: result.entryId });
    expect(await repo.getById('alpha', result.entryId)).toMatchObject({
      name: 'agent',
      source: { kind: 'referenced', reference: 'ghcr.io/acme/agent' },
    });
    const actions = (await auditRepo.getByEntity('imageCatalogEntry', result.entryId)).map((event) => event.action);
    expect(actions.sort()).toEqual(['image_catalog_entry.created', 'image_catalog_entry.version_pull']);
  });

  it('names the act in what it refuses', async () => {
    await expect(
      addReferencedVersion({ ...request, intent: undefined }, scope(), options('pull')),
    ).rejects.toThrow('is pulled');
    await expect(
      addReferencedVersion({ ...request, intent: undefined }, scope(), options('upload')),
    ).rejects.toThrow('is uploaded');

    docker.daemon = daemonWith([{ repository: 'ghcr.io/acme/agent', tag: 'v1', id: 'sha', size: '1MB', created: 'now' }]);
    await expect(addReferencedVersion(request, scope(), options('pull'))).rejects.toThrow('pull another tag');
    await expect(addReferencedVersion(request, scope(), options('upload'))).rejects.toThrow('upload under another tag');
    expect(produced).toHaveLength(0);
  });

  it('refuses before producing when the daemon cannot say whether the tag is free', async () => {
    docker.daemon = UNREACHABLE_DAEMON;

    await expect(addReferencedVersion(request, scope(), options('upload'))).rejects.toThrow(PreconditionFailedError);
    expect(produced).toHaveLength(0);
  });

  it('wraps a failure as an internal error naming the act, and passes a handler error through', async () => {
    await expect(
      addReferencedVersion(request, scope(), options('pull', async () => { throw new Error('manifest unknown'); })),
    ).rejects.toThrow('Pulling "ghcr.io/acme/agent:v1" failed: manifest unknown');
    await expect(
      addReferencedVersion(request, scope(), options('upload', async () => { throw new Error('exit 1'); })),
    ).rejects.toThrow('Building "ghcr.io/acme/agent:v1" failed: exit 1');

    const taken = new ConflictError('taken meanwhile');
    await expect(
      addReferencedVersion(request, scope(), options('pull', async () => { throw taken; })),
    ).rejects.toBe(taken);
    expect(await repo.list('alpha')).toHaveLength(0);
  });

  it('adds a later version without the entry fields, and refuses one that would change them', async () => {
    const first = await addReferencedVersion(request, scope(), options('pull'));

    const second = await addReferencedVersion(
      { namespace: 'alpha', reference: request.reference, tag: 'v2' },
      scope(),
      options('pull'),
    );
    expect(second.entryId).toBe(first.entryId);

    await expect(
      addReferencedVersion({ ...request, tag: 'v3', name: 'Renamed' }, scope(), options('pull')),
    ).rejects.toThrow(ValidationError);
    expect(produced).toEqual(['ghcr.io/acme/agent:v1', 'ghcr.io/acme/agent:v2']);
  });

  it('keeps the entry another first version created meanwhile, and says which fields it did not apply', async () => {
    const racing = options('pull', async () => {
      await addReferencedVersion(
        { ...request, tag: 'v0', intent: 'Created by the other request' },
        scope(),
        options('pull'),
      );
    });

    const error = await addReferencedVersion(request, scope(), racing).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HandlerError);
    expect(error).toBeInstanceOf(ConflictError);
    expect(String((error as Error).message)).toMatch(/was pulled .* intent differ/);
    const [entry] = await repo.list('alpha');
    expect(entry?.intent).toBe('Created by the other request');
  });
});
