import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryProcessRepository, buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import type { WorkflowStep } from '@mediforce/platform-core';
import { previewRepoFiles, browseDraftRepo } from '../preview-repo-files';
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

  it('lists the commit without reading a single file', async () => {
    await save(processRepo, { repo: 'org/repo', commit: COMMIT, dockerfile: 'Dockerfile' });
    const reader = createStubRepoFileReader('FROM r-base\n');
    reader.tree = [{ path: 'Dockerfile' }, { path: 'src/run.py' }];
    const scope = createTestScope({ processRepo, repoFileReader: reader });

    const result = await previewRepoFiles({ name: 'flow', stepId: 'build', namespace: 'tenant-a' }, scope);

    expect(result).toMatchObject({ repo: 'org/repo', commit: COMMIT });
    expect(result.entries).toEqual(reader.tree);
    expect(result.file).toBeUndefined();
  });

  it('fetches one file only when it is asked for', async () => {
    await save(processRepo, { repo: 'org/repo', commit: COMMIT, dockerfile: 'Dockerfile' });
    const reader = createStubRepoFileReader('FROM r-base\n');
    reader.tree = [{ path: 'Dockerfile' }];
    const scope = createTestScope({ processRepo, repoFileReader: reader });

    const result = await previewRepoFiles(
      { name: 'flow', stepId: 'build', namespace: 'tenant-a', path: 'Dockerfile' },
      scope,
    );

    expect(result.file).toEqual({ path: 'Dockerfile', contents: 'FROM r-base\n' });
  });

  it('refuses a file whose contents pass the cap', async () => {
    await save(processRepo, { repo: 'org/repo', commit: COMMIT, dockerfile: 'Dockerfile' });
    const reader = createStubRepoFileReader('x'.repeat(50_000_000));
    reader.tree = [{ path: 'fixtures/huge.csv' }];
    const scope = createTestScope({ processRepo, repoFileReader: reader });

    const result = await previewRepoFiles(
      { name: 'flow', stepId: 'build', namespace: 'tenant-a', path: 'fixtures/huge.csv' },
      scope,
    );

    expect(result.file).toMatchObject({ path: 'fixtures/huge.csv', tooLarge: true });
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

describe('browseDraftRepo', () => {
  it('reads a repository the caller names, with no saved workflow behind it', async () => {
    const reader = createStubRepoFileReader('FROM r-base\n');
    reader.tree = [{ path: 'Dockerfile' }];
    const scope = createTestScope({
      processRepo: new InMemoryProcessRepository(),
      repoFileReader: reader,
      caller: userCaller('u1', ['tenant-a']),
    });

    const result = await browseDraftRepo(
      { namespace: 'tenant-a', repo: 'org/repo', commit: COMMIT },
      scope,
    );

    expect(result).toMatchObject({ repo: 'org/repo', commit: COMMIT });
    expect(result.entries).toEqual(reader.tree);
  });

  it('clones anonymously, never spending the deployment key on a caller-named repo', async () => {
    const reader = createStubRepoFileReader();
    const anonymous: boolean[] = [];
    const wrapped = {
      ...reader,
      list: async (options: { anonymousOnly?: boolean }) => {
        anonymous.push(options.anonymousOnly === true);
        return reader.list(options as never);
      },
    };
    const scope = createTestScope({
      processRepo: new InMemoryProcessRepository(),
      repoFileReader: wrapped as never,
      caller: userCaller('u1', ['tenant-a']),
    });

    await browseDraftRepo({ namespace: 'tenant-a', repo: 'org/repo', commit: COMMIT }, scope);
    expect(anonymous).toEqual([true]);
  });

  it('does not list the tree when one file was asked for', async () => {
    const reader = createStubRepoFileReader();
    reader.tree = [{ path: 'Dockerfile' }];
    const scope = createTestScope({
      processRepo: new InMemoryProcessRepository(),
      repoFileReader: reader,
      caller: userCaller('u1', ['tenant-a']),
    });

    await browseDraftRepo(
      { namespace: 'tenant-a', repo: 'org/repo', commit: COMMIT, path: 'Dockerfile' },
      scope,
    );

    // One read, the open. A listing here would be a second clone of the commit.
    expect(reader.reads).toHaveLength(1);
    expect(reader.reads[0]!.paths).toEqual(['Dockerfile']);
  });

  it('never sends a token, since a draft has no workflow secrets', async () => {
    const reader = createStubRepoFileReader();
    const scope = createTestScope({
      processRepo: new InMemoryProcessRepository(),
      repoFileReader: reader,
      caller: userCaller('u1', ['tenant-a']),
    });

    await browseDraftRepo({ namespace: 'tenant-a', repo: 'org/repo', commit: COMMIT }, scope);

    expect(reader.reads.every((read) => read.token === undefined)).toBe(true);
  });

  it('refuses a namespace the caller does not belong to', async () => {
    const scope = createTestScope({
      processRepo: new InMemoryProcessRepository(),
      repoFileReader: createStubRepoFileReader(),
      caller: userCaller('u1', ['tenant-a']),
    });

    await expect(
      browseDraftRepo({ namespace: 'someone-else', repo: 'org/repo', commit: COMMIT }, scope),
    ).rejects.toThrow(/not a member/);
  });

  it('refuses a local path and a host off the allowlist, exactly as the saved read does', async () => {
    const scope = createTestScope({
      processRepo: new InMemoryProcessRepository(),
      repoFileReader: createStubRepoFileReader(),
      caller: userCaller('u1', ['tenant-a']),
    });

    await expect(
      browseDraftRepo({ namespace: 'tenant-a', repo: '/etc', commit: COMMIT }, scope),
    ).rejects.toThrow(/local filesystem path/);
    await expect(
      browseDraftRepo({ namespace: 'tenant-a', repo: 'https://evil.example/repo', commit: COMMIT }, scope),
    ).rejects.toThrow(/not on a host/);
  });
});
