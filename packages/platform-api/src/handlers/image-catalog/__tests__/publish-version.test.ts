import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveCarriedBuild } from '@mediforce/agent-runtime';
import {
  listBuildContextArchive,
  type BuildUploadedImageRequest,
  type WorkflowArtifact,
} from '@mediforce/platform-core';
import {
  buildWorkflowDefinition,
  InMemoryAuditRepository,
  InMemoryImageCatalogRepository,
  InMemoryProcessRepository,
} from '@mediforce/platform-core/testing';
import { NotFoundError, PreconditionFailedError, ValidationError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import type { DockerImageInfo } from '../../../contract/system';
import type { DaemonImageListing } from '../../system/_docker';
import { daemonWith, builtImage } from './fixtures';

const docker = vi.hoisted(() => ({
  daemon: { available: false, images: [] } as DaemonImageListing,
  builds: [] as Array<{ request: BuildUploadedImageRequest; archive: Uint8Array }>,
}));
vi.mock('../../system/_docker', () => ({
  fetchDaemonImages: async () => docker.daemon,
  probeImageCapabilities: async () => ({ status: 'unknown' }),
  fetchImageHistory: async () => null,
  buildUploadedImage: async (request: BuildUploadedImageRequest, archive: Uint8Array) => {
    docker.builds.push({ request, archive });
  },
}));

const { publishImageCatalogVersion } = await import('../publish-version');
const { deriveImageCatalogEntryId } = await import('../_source');

const ARTIFACTS: WorkflowArtifact[] = [
  { path: 'container/Dockerfile', contents: 'FROM alpine:3.21\nCOPY entrypoint.sh /\n' },
  { path: 'container/entrypoint.sh', contents: 'echo intake\n' },
  { path: 'scripts/poll.py', contents: 'print("poll")\n' },
];

function intakeVersion(version: number, artifacts: WorkflowArtifact[]) {
  return buildWorkflowDefinition({
    name: 'intake',
    namespace: 'alpha',
    version,
    artifacts,
    steps: [
      { id: 'check', name: 'Check', type: 'creation', executor: 'script', script: { dockerfile: 'container/Dockerfile', command: '/entrypoint.sh' } },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'check', to: 'done' }],
  });
}

/** The image a run of `definition` builds, as the daemon lists it. */
function carriedImageOf(definition: ReturnType<typeof intakeVersion>): DockerImageInfo {
  const build = resolveCarriedBuild({ dockerfile: 'container/Dockerfile' }, definition);
  if (build === undefined) throw new Error('not a carried build');
  return {
    ...builtImage(),
    repository: 'mediforce-artifacts',
    tag: build.tag.replace('mediforce-artifacts:', ''),
    id: `sha-${String(definition.version)}`,
    buildRepo: undefined,
    buildCommit: undefined,
    buildContext: undefined,
    buildDockerfile: 'container/Dockerfile',
    buildWorkflow: 'intake',
    buildNamespace: 'alpha',
    buildArtifacts: build.meta.artifactsHash,
  };
}

const ENTRY_ID = deriveImageCatalogEntryId({ kind: 'carried', workflow: 'intake', dockerfile: 'container/Dockerfile' });

describe('publishImageCatalogVersion handler', () => {
  let processRepo: InMemoryProcessRepository;
  let imageCatalogRepo: InMemoryImageCatalogRepository;

  beforeEach(() => {
    processRepo = new InMemoryProcessRepository();
    imageCatalogRepo = new InMemoryImageCatalogRepository();
    docker.builds = [];
  });

  const scope = () =>
    createTestScope({
      processRepo,
      imageCatalogRepo,
      auditRepo: new InMemoryAuditRepository(),
      caller: userCaller('u-member', ['alpha']),
    });

  const input = (imageTag: string) => ({
    namespace: 'alpha',
    id: ENTRY_ID,
    imageTag,
    reference: 'alpha/intake',
    tag: 'v1',
    intent: 'Intake checks, kept after the workflow moves on',
  });

  it("rebuilds the version's own build context under the reference, as an upload", async () => {
    const v1 = intakeVersion(1, ARTIFACTS);
    const v2 = intakeVersion(2, [ARTIFACTS[0], { path: 'container/entrypoint.sh', contents: 'echo v2\n' }]);
    await processRepo.saveWorkflowDefinition(v1);
    await processRepo.saveWorkflowDefinition(v2);
    const older = carriedImageOf(v1);
    docker.daemon = daemonWith([carriedImageOf(v2), older]);

    const result = await publishImageCatalogVersion(input(`mediforce-artifacts:${older.tag}`), scope());

    expect(result.imageTag).toBe('alpha/intake:v1');
    expect(docker.builds[0]?.request).toEqual({
      image: 'alpha/intake:v1',
      dockerfile: 'container/Dockerfile',
      namespace: 'alpha',
    });
    // The files of v1 — the version that image was built from, not the current
    // one — and all of them, since the whole carried set is its context.
    const archive = docker.builds[0]?.archive ?? new Uint8Array();
    expect(listBuildContextArchive(archive).map((entry) => entry.path).sort()).toEqual([
      'container/Dockerfile',
      'container/entrypoint.sh',
      'scripts/poll.py',
    ]);
    expect(new TextDecoder().decode(archive)).toContain('echo intake');
    expect(await imageCatalogRepo.getById('alpha', result.entryId)).toMatchObject({
      source: { kind: 'referenced', reference: 'alpha/intake' },
    });
  });

  it('refuses a version no workflow version still carries the files for', async () => {
    const v1 = intakeVersion(1, ARTIFACTS);
    const image = carriedImageOf(v1);
    docker.daemon = daemonWith([image]);

    await expect(
      publishImageCatalogVersion(input(`mediforce-artifacts:${image.tag}`), scope()),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
    expect(docker.builds).toEqual([]);
  });

  it('refuses a tag that is not a version of the entry', async () => {
    const v1 = intakeVersion(1, ARTIFACTS);
    await processRepo.saveWorkflowDefinition(v1);
    docker.daemon = daemonWith([carriedImageOf(v1)]);

    await expect(publishImageCatalogVersion(input('postgres:16'), scope())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses an entry that is not carried', async () => {
    docker.daemon = daemonWith([builtImage({ buildNamespace: 'alpha' })]);
    const builtId = deriveImageCatalogEntryId({
      kind: 'built',
      repo: builtImage().buildRepo ?? '',
      dockerfile: 'container/Dockerfile',
    });

    await expect(
      publishImageCatalogVersion({ ...input(`${builtImage().repository}:${builtImage().tag}`), id: builtId }, scope()),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
