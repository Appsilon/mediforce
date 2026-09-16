import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryProcessRepository, buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import type { WorkflowStep } from '@mediforce/platform-core';
import { previewRepoFiles } from '../preview-repo-files';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../errors';
import { createStubRepoFileReader } from '../../../runtime/repo-file-reader';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import type { WorkflowSecretsRepository } from '@mediforce/platform-core';

/** The shared scope's secrets repo is a no-op stub, so this test brings its own. */
function secretsHolding(values: Record<string, string>): WorkflowSecretsRepository {
  return {
    getSecrets: () => Promise.resolve(values),
    getSecretKeys: () => Promise.resolve(Object.keys(values)),
    setSecrets: () => Promise.resolve(),
    deleteSecrets: () => Promise.resolve(),
  } as unknown as WorkflowSecretsRepository;
}

const COMMIT = '9f2c1d4a7b30e58c6a1f42db9e7c05a8b3d16f27';

function buildStep(script: Record<string, unknown>): WorkflowStep {
  return {
    id: 'build', name: 'Build', type: 'creation', executor: 'script',
    script: { inlineScript: 'echo hi\n', runtime: 'bash', ...script },
  } as unknown as WorkflowStep;
}

async function save(
  processRepo: InMemoryProcessRepository,
  script: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await processRepo.saveWorkflowDefinition({
    ...buildWorkflowDefinition({ name: 'flow', version: 1, namespace: 'tenant-a' }),
    steps: [buildStep(script)],
    transitions: [],
    ...extra,
  });
}

describe('previewRepoFiles handler', () => {
  let processRepo: InMemoryProcessRepository;

  beforeEach(() => {
    processRepo = new InMemoryProcessRepository();
  });

  it('reads the paths the step names, at the commit it pins', async () => {
    await save(processRepo, { repo: 'org/repo', commit: COMMIT, dockerfile: 'Dockerfile' });
    const reader = createStubRepoFileReader('FROM r-base\n');
    const scope = createTestScope({ processRepo, repoFileReader: reader });

    const result = await previewRepoFiles({ name: 'flow', stepId: 'build', namespace: 'tenant-a' }, scope);

    expect(result).toMatchObject({ repo: 'org/repo', commit: COMMIT });
    expect(result.files).toEqual([{ path: 'Dockerfile', contents: 'FROM r-base\n' }]);
    expect(reader.reads).toEqual([
      { repo: 'org/repo', commit: COMMIT, paths: ['Dockerfile'] },
    ]);
  });

  it('hands the repoAuth secret to the clone and reports only its name', async () => {
    await save(processRepo, { repo: 'org/repo', commit: COMMIT, dockerfile: 'Dockerfile', repoAuth: 'REPO_TOKEN' });
    const reader = createStubRepoFileReader();
    const scope = createTestScope({
      processRepo,
      repoFileReader: reader,
      caller: userCaller('u1', ['tenant-a']),
      secretsRepo: secretsHolding({ REPO_TOKEN: 'ghp-secret' }),
    });

    const result = await previewRepoFiles({ name: 'flow', stepId: 'build', namespace: 'tenant-a' }, scope);

    expect(reader.reads[0].token).toBe('ghp-secret');
    expect(result.usedAuthKey).toBe('REPO_TOKEN');
    expect(JSON.stringify(result)).not.toContain('ghp-secret');
  });

  it('refuses a local filesystem path, which would read the server disk', async () => {
    await save(processRepo, { repo: '/etc/secrets', commit: COMMIT, dockerfile: 'Dockerfile' });
    const scope = createTestScope({ processRepo });
    await expect(previewRepoFiles({ name: 'flow', stepId: 'build', namespace: 'tenant-a' }, scope))
      .rejects.toThrow(ValidationError);
  });

  it('refuses a host outside the allowlist, which would receive repoAuth as basic auth', async () => {
    await save(processRepo, { repo: 'https://evil.example/org/repo', commit: COMMIT, dockerfile: 'Dockerfile' });
    const scope = createTestScope({ processRepo });
    await expect(previewRepoFiles({ name: 'flow', stepId: 'build', namespace: 'tenant-a' }, scope))
      .rejects.toThrow(/host/i);
  });

  it('refuses a public workflow from another workspace, since the clone uses the platform key', async () => {
    await save(processRepo, { repo: 'org/repo', commit: COMMIT, dockerfile: 'Dockerfile' }, { visibility: 'public' });
    const scope = createTestScope({ processRepo, caller: userCaller('u2', ['tenant-b']) });
    await expect(previewRepoFiles({ name: 'flow', stepId: 'build', namespace: 'tenant-a' }, scope))
      .rejects.toThrow(ForbiddenError);
  });

  it('refuses a step that builds from no repository', async () => {
    await save(processRepo, { image: 'mediforce-golden-image' });
    const scope = createTestScope({ processRepo });
    await expect(previewRepoFiles({ name: 'flow', stepId: 'build', namespace: 'tenant-a' }, scope))
      .rejects.toThrow(ValidationError);
  });

  it('is a 404 for an unknown step and an unknown workflow', async () => {
    await save(processRepo, { repo: 'org/repo', commit: COMMIT, dockerfile: 'Dockerfile' });
    const scope = createTestScope({ processRepo });
    await expect(previewRepoFiles({ name: 'flow', stepId: 'nope', namespace: 'tenant-a' }, scope))
      .rejects.toThrow(NotFoundError);
    await expect(previewRepoFiles({ name: 'missing', stepId: 'build', namespace: 'tenant-a' }, scope))
      .rejects.toThrow(NotFoundError);
  });
});
