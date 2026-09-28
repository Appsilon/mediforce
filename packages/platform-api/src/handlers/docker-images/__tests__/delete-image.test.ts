import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildWorkflowDefinition,
  InMemoryAuditRepository,
  InMemoryProcessRepository,
} from '@mediforce/platform-core/testing';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { ConflictError, ForbiddenError, PreconditionFailedError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import type { DockerImagesService } from '../../../services/docker-images-service';
import type { CallerIdentity } from '../../../auth';
import type { DaemonImageListing } from '../../system/_docker';

// The id -> tag resolution behind the live-pin scan reads the daemon, which no
// unit test may shell out to.
const daemon = vi.hoisted(() => ({
  value: { available: true, images: [] } as DaemonImageListing,
  fetch: vi.fn(),
}));
vi.mock('../../system/_docker', () => ({
  fetchDaemonImages: async () => {
    daemon.fetch();
    return daemon.value;
  },
}));

const { deleteDockerImage } = await import('../delete-image');

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
    daemon.value = { available: true, images: [] };
    daemon.fetch.mockClear();
  });

  /** A workflow version whose one agent step pins `image`. Seeded through the
   *  raw repo, since the authorized wrapper refuses a write to a namespace the
   *  caller is not a member of — and a foreign-namespace pin is exactly what
   *  this check has to notice. */
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

  /** A scope for `caller` with these definitions already on the platform. */
  const scopeWith = async (caller: CallerIdentity, definitions: WorkflowDefinition[]) => {
    const processRepo = new InMemoryProcessRepository();
    for (const definition of definitions) {
      await processRepo.saveWorkflowDefinition(definition);
    }
    return createTestScope({ auditRepo, processRepo, dockerImages: deleter, caller });
  };

  /** Owner of their own personal workspace and nothing else — the caller the
   *  loose gate lets through, which is nearly every user. */
  const personalWorkspaceCaller = userCaller(
    'u-personal',
    ['solo'],
    new Map([['solo', 'owner']]),
  );

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

  it('[PINS] refuses a name:tag a live version in another namespace still runs on', async () => {
    const scope = await scopeWith(personalWorkspaceCaller, [pinning('shared-r:4.4')]);

    await expect(
      deleteDockerImage({ imageId: 'shared-r:4.4' }, scope),
    ).rejects.toBeInstanceOf(ConflictError);
    // The gate passes this caller, so nothing but the scan stands between a
    // personal-workspace owner and every step in `alpha` (#1375).
    expect(deleter.calls).toEqual([]);
  });

  it('[PINS] redacts a workflow the caller cannot see, and still counts it', async () => {
    const scope = await scopeWith(personalWorkspaceCaller, [pinning('shared-r:4.4')]);

    await expect(deleteDockerImage({ imageId: 'shared-r:4.4' }, scope)).rejects.toThrow(
      /1 more in a workspace you cannot see/,
    );
    await expect(deleteDockerImage({ imageId: 'shared-r:4.4' }, scope)).rejects.not.toThrow(
      /sdtm-qc/,
    );
  });

  it('[PINS] names the workflow for a caller who is a member of its workspace', async () => {
    const scope = await scopeWith(
      userCaller('u-admin', ['alpha'], new Map([['alpha', 'admin']])),
      [pinning('shared-r:4.4', { version: 4 })],
    );

    await expect(deleteDockerImage({ imageId: 'shared-r:4.4' }, scope)).rejects.toThrow(
      /alpha\/sdtm-qc v4 \(analyse\)/,
    );
  });

  it('[PINS] treats `repo` and `repo:latest` as the same image', async () => {
    const scope = await scopeWith(personalWorkspaceCaller, [pinning('shared-r:latest')]);

    await expect(
      deleteDockerImage({ imageId: 'shared-r' }, scope),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('[PINS] reads a colon before a slash as a registry port, not a tag', async () => {
    // `localhost:5000/acme/agent` is untagged — the colon is the port — so it
    // names `:latest` just as `shared-r` does, and the live pin blocks it.
    const scope = await scopeWith(personalWorkspaceCaller, [
      pinning('localhost:5000/acme/agent:latest'),
    ]);

    await expect(
      deleteDockerImage({ imageId: 'localhost:5000/acme/agent' }, scope),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(deleter.calls).toEqual([]);
  });

  it('[PINS] deletes anyway when only a superseded version pins it', async () => {
    const scope = await scopeWith(personalWorkspaceCaller, [
      pinning('shared-r:4.4', { version: 1 }),
      pinning('unrelated:v1', { version: 2 }),
    ]);

    // A registered version is immutable, so no edit can move v1 off this image;
    // refusing on its account would mean the image can never be reclaimed.
    await expect(deleteDockerImage({ imageId: 'shared-r:4.4' }, scope)).resolves.toBeTruthy();
    expect(deleter.calls).toEqual(['shared-r:4.4']);
  });

  it('[PINS] deletes an unpinned image without consulting the daemon', async () => {
    const scope = await scopeWith(personalWorkspaceCaller, [pinning('something-else:v1')]);

    await expect(deleteDockerImage({ imageId: 'shared-r:4.4' }, scope)).resolves.toBeTruthy();
    expect(deleter.calls).toEqual(['shared-r:4.4']);
    // A `name:tag` names its own tag, so there is nothing to ask the daemon.
    expect(daemon.fetch).not.toHaveBeenCalled();
  });

  it('[PINS] refuses a hex-looking repository name its live pin names', async () => {
    // `facade` is legal hex *and* a legal repository name, and the reference
    // says which it is. Reading it as an id alone would drop the only needle
    // that matches, and destroy the image a live version runs on.
    const scope = await scopeWith(personalWorkspaceCaller, [pinning('facade:latest')]);

    await expect(deleteDockerImage({ imageId: 'facade' }, scope)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(deleter.calls).toEqual([]);
  });

  it('[PINS] prefers the live-pin refusal over the unreadable-listing one', async () => {
    daemon.value = { available: false, images: [] };
    const scope = await scopeWith(personalWorkspaceCaller, [pinning('facade:latest')]);

    // The reference is pinned whatever the listing says, and a message naming
    // the workflow is worth more than one naming the daemon.
    await expect(deleteDockerImage({ imageId: 'facade' }, scope)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(deleter.calls).toEqual([]);
  });

  it('[PINS] refuses an id outright when the daemon cannot list its tags', async () => {
    daemon.value = { available: false, images: [] };
    const scope = await scopeWith(personalWorkspaceCaller, [pinning('shared-r:4.4')]);

    // An unreachable daemon degrades to an empty listing, which read as "no
    // tags" would let an id through unchecked — the hole this closes.
    await expect(
      deleteDockerImage({ imageId: 'abc123def4567' }, scope),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
    expect(deleter.calls).toEqual([]);
  });

  it('[PINS] resolves an image id to every tag that names it', async () => {
    // `docker rmi <id>` takes every tag with it, so a pin on the second one
    // blocks just as the first would.
    daemon.value = {
      available: true,
      images: [
        {
          repository: 'shared-r',
          tag: '4.4',
          id: 'abc123def4567',
          size: '1GB',
          created: '2 days ago',
        },
        {
          repository: 'shared-r',
          tag: 'latest',
          id: 'abc123def4567',
          size: '1GB',
          created: '2 days ago',
        },
      ],
    };
    const scope = await scopeWith(personalWorkspaceCaller, [pinning('shared-r:latest')]);

    await expect(
      deleteDockerImage({ imageId: 'abc123def4567' }, scope),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(deleter.calls).toEqual([]);
  });

  it('[PINS] lets an id through when none of its tags is pinned', async () => {
    daemon.value = {
      available: true,
      images: [
        {
          repository: 'shared-r',
          tag: '4.4',
          id: 'abc123def4567',
          size: '1GB',
          created: '2 days ago',
        },
      ],
    };
    const scope = await scopeWith(personalWorkspaceCaller, [pinning('other:v1')]);

    await expect(deleteDockerImage({ imageId: 'abc123def4567' }, scope)).resolves.toBeTruthy();
    expect(deleter.calls).toEqual(['abc123def4567']);
  });
});
