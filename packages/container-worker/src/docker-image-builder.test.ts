import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  mkdtemp: vi.fn(),
  rm: vi.fn(),
}));

// The clone is never on disk here, so every path resolves to itself.
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  realpathSync: vi.fn((path: string) => path),
}));

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { buildImageFromRepo, ensureImage } from './docker-image-builder';

const execFileSyncMock = vi.mocked(execFileSync);
const mkdtempMock = vi.mocked(mkdtemp);
const rmMock = vi.mocked(rm);
const realpathSyncMock = vi.mocked(realpathSync);

beforeEach(() => {
  vi.clearAllMocks();
  realpathSyncMock.mockImplementation((path) => String(path));
  delete process.env.DEPLOY_KEY_PATH;
  mkdtempMock.mockResolvedValue('/tmp/mediforce-worker-build-abc');
  rmMock.mockResolvedValue(undefined);
  execFileSyncMock.mockReturnValue(Buffer.from(''));
});

afterEach(() => {
  delete process.env.DEPLOY_KEY_PATH;
});

/** git fetch invocations in call order — one per attempted clone transport. */
function fetchCalls(): Parameters<typeof execFileSync>[] {
  return execFileSyncMock.mock.calls.filter(
    ([command, args]) => command === 'git' && args?.includes('fetch'),
  );
}

/** Value of a `--label key=value` pair in the `docker build` arguments. */
function buildLabel(key: string): string | undefined {
  const call = execFileSyncMock.mock.calls.find(
    ([command, args]) => command === 'docker' && args?.[0] === 'build',
  );
  return (call?.[1] as string[] | undefined)
    ?.find((arg) => arg.startsWith(`${key}=`))
    ?.slice(key.length + 1);
}

describe('container-worker buildImageFromRepo', () => {
  it('writes the same build labels as the agent-runtime copy', async () => {
    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: 'git@github.com:owner/repo.git',
      commit: 'abc123',
      dockerfile: 'container/Dockerfile',
      workflow: 'sdtm-mapping',
      namespace: 'acme',
    });

    expect(buildLabel('mediforce.build.repo')).toBe('git@github.com:owner/repo.git');
    expect(buildLabel('mediforce.build.commit')).toBe('abc123');
    expect(buildLabel('mediforce.build.dockerfile')).toBe('container/Dockerfile');
    expect(buildLabel('mediforce.build.workflow')).toBe('sdtm-mapping');
    expect(buildLabel('mediforce.build.namespace')).toBe('acme');
    expect(buildLabel('org.opencontainers.image.source')).toBe('https://github.com/owner/repo');
    expect(buildLabel('org.opencontainers.image.revision')).toBe('abc123');
  });

  it('builds from the named context, like the agent-runtime copy', async () => {
    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: 'git@github.com:owner/repo.git',
      commit: 'abc123',
      dockerfile: 'container/Dockerfile',
      context: '.',
    });

    const call = execFileSyncMock.mock.calls.find(
      ([command, args]) => command === 'docker' && args?.[0] === 'build',
    );
    const args = call?.[1] as string[] | undefined;
    expect(args?.[(args?.indexOf('-f') ?? 0) + 1]).toBe(
      '/tmp/mediforce-worker-build-abc/container/Dockerfile',
    );
    expect(args?.at(-1)).toBe('/tmp/mediforce-worker-build-abc');
    expect(buildLabel('mediforce.build.context')).toBe('.');
  });

  it('keeps the Dockerfile\'s own directory as the context when none is named', async () => {
    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: 'git@github.com:owner/repo.git',
      commit: 'abc123',
      dockerfile: 'container/Dockerfile',
    });

    const call = execFileSyncMock.mock.calls.find(
      ([command, args]) => command === 'docker' && args?.[0] === 'build',
    );
    expect((call?.[1] as string[] | undefined)?.at(-1)).toBe('/tmp/mediforce-worker-build-abc/container');
    // Written empty so it overrides any context inherited from the base image.
    expect(buildLabel('mediforce.build.context')).toBe('');
  });

  it('refuses a context the checkout symlinks outside the clone, before building', async () => {
    realpathSyncMock.mockImplementation((path) =>
      String(path) === '/tmp/mediforce-worker-build-abc/ctx' ? '/' : String(path),
    );

    await expect(
      buildImageFromRepo({
        image: 'test-image',
        repoUrl: 'git@github.com:owner/repo.git',
        commit: 'abc123',
        dockerfile: '../Dockerfile',
        context: 'ctx',
      }),
    ).rejects.toThrow(/outside the repository/);

    const built = execFileSyncMock.mock.calls.some(
      ([command, args]) => command === 'docker' && args?.[0] === 'build',
    );
    expect(built).toBe(false);
  });

  it('refuses a context outside the clone before cloning anything', async () => {
    await expect(
      buildImageFromRepo({
        image: 'test-image',
        repoUrl: 'git@github.com:owner/repo.git',
        commit: 'abc123',
        context: '../..',
      }),
    ).rejects.toThrow(/outside the repository/);
    expect(fetchCalls()).toHaveLength(0);
  });

  it('uses anonymous HTTPS for owner/repo shorthand without a deploy key', async () => {
    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: 'git@github.com:owner/repo.git',
      repoRef: 'owner/repo',
      commit: 'abc123',
    });

    const [command, args, options] = fetchCalls()[0];
    expect(command).toBe('git');
    expect(args).toContain('https://github.com/owner/repo');
    expect(options?.env?.GIT_SSH_COMMAND).toBeUndefined();
  });

  it('uses SSH for a non-GitHub git@ ref', async () => {
    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: 'git@gitlab.com:owner/repo.git',
      repoRef: 'git@gitlab.com:owner/repo.git',
      commit: 'abc123',
    });

    const [command, args, options] = fetchCalls()[0];
    expect(command).toBe('git');
    expect(args).toContain('git@gitlab.com:owner/repo.git');
    expect(options?.env?.GIT_SSH_COMMAND).toContain('ssh -i');
  });

  it('builds a public repo given in GitHub SSH form over anonymous HTTPS when the deploy key is unusable', async () => {
    const deployKeyDirectory = mkdtempSync(join(tmpdir(), 'mediforce-worker-deploy-key-'));
    process.env.DEPLOY_KEY_PATH = deployKeyDirectory;

    try {
      await buildImageFromRepo({
        image: 'test-image',
        repoUrl: 'git@github.com:owner/public.git',
        repoRef: 'git@github.com:owner/public.git',
        commit: 'abc123',
      });

      const fetches = fetchCalls();
      expect(fetches).toHaveLength(1);
      const [, args, options] = fetches[0];
      expect(args).toContain('https://github.com/owner/public');
      expect(options?.env?.GIT_SSH_COMMAND).toBeUndefined();
    } finally {
      rmSync(deployKeyDirectory, { recursive: true, force: true });
    }
  });

  it('names every transport that failed, so a broken deploy key is not hidden behind the HTTPS error', async () => {
    const deployKeyDirectory = mkdtempSync(join(tmpdir(), 'mediforce-worker-deploy-key-'));
    process.env.DEPLOY_KEY_PATH = deployKeyDirectory;
    execFileSyncMock.mockImplementation((_command, args) => {
      if (args?.includes('fetch')) throw new Error('remote: Repository not found');
      return Buffer.from('');
    });

    try {
      await expect(
        buildImageFromRepo({
          image: 'test-image',
          repoUrl: 'git@github.com:owner/private.git',
          repoRef: 'git@github.com:owner/private.git',
          commit: 'abc123',
        }),
      ).rejects.toThrow(/over SSH then HTTPS: SSH: Deploy key path .* regular file\.; HTTPS: remote: Repository not found/);
    } finally {
      rmSync(deployKeyDirectory, { recursive: true, force: true });
    }
  });

  it('disables git auto-maintenance on the throwaway clone, whose detached run would race its removal', async () => {
    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: 'git@github.com:owner/repo.git',
      repoRef: 'owner/repo',
      commit: 'abc123',
    });

    const [, args] = fetchCalls()[0];
    expect(args).toEqual(expect.arrayContaining(['-c', 'maintenance.auto=false']));
  });

  it('falls back to the SSH deploy key when anonymous HTTPS cannot see a private owner/repo', async () => {
    execFileSyncMock.mockImplementation((_command, args) => {
      if (args?.includes('https://github.com/owner/private')) {
        throw new Error('remote: Repository not found');
      }
      return Buffer.from('');
    });

    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: 'git@github.com:owner/private.git',
      repoRef: 'owner/private',
      commit: 'abc123',
    });

    const fetches = fetchCalls();
    expect(fetches).toHaveLength(2);
    const [command, args, options] = fetches[1];
    expect(command).toBe('git');
    expect(args).toContain('git@github.com:owner/private.git');
    expect(options?.env?.GIT_SSH_COMMAND).toContain('ssh -i');
  });

  it('redacts repository tokens from clone errors and warnings', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    execFileSyncMock.mockImplementation((_command, args) => {
      if (args?.includes('fetch')) {
        throw new Error('fatal: https://x-access-token:SECRET@github.com/owner/private.git');
      }
      return Buffer.from('');
    });

    try {
      let caughtError: unknown;
      try {
        await buildImageFromRepo({
          image: 'test-image',
          repoUrl: 'git@github.com:owner/private.git',
          repoRef: 'owner/private',
          commit: 'abc123',
          repoToken: 'SECRET',
        });
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeInstanceOf(Error);
      expect((caughtError as Error).message).toContain('Failed to fetch');
      expect((caughtError as Error).message).not.toContain('SECRET');
      expect(warning.mock.calls.flat().join(' ')).not.toContain('SECRET');
    } finally {
      warning.mockRestore();
    }
  });

  it('rejects a directory configured as the SSH deploy key source', async () => {
    const deployKeyDirectory = mkdtempSync(join(tmpdir(), 'mediforce-worker-deploy-key-'));
    process.env.DEPLOY_KEY_PATH = deployKeyDirectory;

    try {
      await expect(
        buildImageFromRepo({
          image: 'test-image',
          repoUrl: 'git@gitlab.com:owner/repo.git',
          repoRef: 'git@gitlab.com:owner/repo.git',
          commit: 'abc123',
        }),
      ).rejects.toThrow(/deploy key.*regular file/i);
    } finally {
      rmSync(deployKeyDirectory, { recursive: true, force: true });
    }
  });
});

// Mirrors the agent-runtime copy: a step that names its own tag for a carried
// Dockerfile is rebuilt when the files behind it change.
describe('container-worker ensureImage — a Dockerfile the workflow carries', () => {
  it('does not rebuild an image already built from these files', async () => {
    execFileSyncMock.mockReturnValueOnce(Buffer.from('')); // inspect succeeds
    execFileSyncMock.mockReturnValueOnce(Buffer.from('abc123\n')); // artifacts label

    await ensureImage({ image: 'my-registry/mine:v2', contextDir: '/ctx', artifactsHash: 'abc123' });

    expect(execFileSyncMock.mock.calls.some(([command, args]) => command === 'docker' && args?.[0] === 'build')).toBe(false);
  });

  it('rebuilds an image the step named once the files it was built from change', async () => {
    execFileSyncMock.mockReturnValueOnce(Buffer.from('')); // inspect succeeds
    execFileSyncMock.mockReturnValueOnce(Buffer.from('old000hash00\n')); // artifacts label

    await ensureImage({
      image: 'my-registry/mine:v2',
      contextDir: '/ctx',
      artifactsHash: 'new111hash11',
      workflow: 'wf',
      namespace: 'acme',
    });

    expect(buildLabel('mediforce.build.artifacts')).toBe('new111hash11');
    expect(buildLabel('mediforce.build.namespace')).toBe('acme');
    expect(buildLabel('mediforce.build.repo')).toBe('');
  });
});
