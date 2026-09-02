import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  mkdtemp: vi.fn(),
  rm: vi.fn(),
}));

import { execFileSync, execSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { buildImageFromRepo } from './docker-image-builder';

const execSyncMock = vi.mocked(execSync);
const execFileSyncMock = vi.mocked(execFileSync);
const mkdtempMock = vi.mocked(mkdtemp);
const rmMock = vi.mocked(rm);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DEPLOY_KEY_PATH;
  mkdtempMock.mockResolvedValue('/tmp/mediforce-worker-build-abc');
  rmMock.mockResolvedValue(undefined);
  execSyncMock.mockReturnValue(Buffer.from(''));
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

  it('uses SSH for git@ refs', async () => {
    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: 'git@github.com:owner/repo.git',
      repoRef: 'git@github.com:owner/repo.git',
      commit: 'abc123',
    });

    const [command, args, options] = fetchCalls()[0];
    expect(command).toBe('git');
    expect(args).toContain('git@github.com:owner/repo.git');
    expect(options?.env?.GIT_SSH_COMMAND).toContain('ssh -i');
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
          repoUrl: 'git@github.com:owner/repo.git',
          repoRef: 'git@github.com:owner/repo.git',
          commit: 'abc123',
        }),
      ).rejects.toThrow(/deploy key.*regular file/i);
    } finally {
      rmSync(deployKeyDirectory, { recursive: true, force: true });
    }
  });
});
