import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  mkdtemp: vi.fn(),
  rm: vi.fn(),
}));

import { execFileSync, execSync, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import {
  imageExistsLocally,
  getImageBuildCommit,
  buildImageFromRepo,
  ensureImage,
} from '../docker-image-builder';

const execSyncMock = vi.mocked(execSync);
const execFileSyncMock = vi.mocked(execFileSync);
const mkdtempMock = vi.mocked(mkdtemp);
const rmMock = vi.mocked(rm);

beforeEach(() => {
  vi.clearAllMocks();
  mkdtempMock.mockResolvedValue('/tmp/mediforce-build-abc');
  rmMock.mockResolvedValue(undefined);
  execFileSyncMock.mockReturnValue(Buffer.from(''));
});

/** git fetch invocations in call order — one per attempted clone transport. */
function fetchCalls(): Parameters<typeof execFileSync>[] {
  return execFileSyncMock.mock.calls.filter(
    ([command, args]) => command === 'git' && args?.includes('fetch'),
  );
}

/** Argument list of the `docker build` invocation, or undefined if it never ran. */
function buildArgs(): string[] | undefined {
  const call = execFileSyncMock.mock.calls.find(
    ([command, args]) => command === 'docker' && args?.[0] === 'build',
  );
  return call?.[1] as string[] | undefined;
}

/** Value of a `--label key=value` pair in the build arguments. */
function buildLabel(args: string[] | undefined, key: string): string | undefined {
  return args
    ?.find((arg) => arg.startsWith(`${key}=`))
    ?.slice(key.length + 1);
}

describe('imageExistsLocally', () => {
  it('returns true when docker image inspect succeeds', async () => {
    execSyncMock.mockReturnValueOnce(Buffer.from(''));
    const result = await imageExistsLocally('my-image:latest');
    expect(result).toBe(true);
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('docker image inspect'),
      expect.anything(),
    );
  });

  it('returns false when docker image inspect fails', async () => {
    execSyncMock.mockImplementationOnce(() => {
      throw new Error('No such image');
    });
    const result = await imageExistsLocally('missing-image');
    expect(result).toBe(false);
  });
});

describe('getImageBuildCommit', () => {
  it('returns commit SHA from image label', async () => {
    execSyncMock.mockReturnValueOnce(Buffer.from('abc123def456\n'));
    const result = await getImageBuildCommit('my-image');
    expect(result).toBe('abc123def456');
  });

  it('returns null when image has no build label', async () => {
    execSyncMock.mockReturnValueOnce(Buffer.from('\n'));
    const result = await getImageBuildCommit('my-image');
    expect(result).toBeNull();
  });

  it('returns null when docker inspect fails', async () => {
    execSyncMock.mockImplementationOnce(() => {
      throw new Error('No such image');
    });
    const result = await getImageBuildCommit('missing-image');
    expect(result).toBeNull();
  });
});

describe('buildImageFromRepo', () => {
  it('clones repo at specific commit and runs docker build', async () => {
    // All Docker and Git calls succeed
    execSyncMock.mockReturnValue(Buffer.from(''));

    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: '/tmp/test-repo.git',
      commit: 'abc123',
    });

    const gitCalls = execFileSyncMock.mock.calls;

    // Should init, fetch the commit from the clone URL, and checkout without shell interpolation.
    expect(gitCalls).toContainEqual(['git', ['init', '/tmp/mediforce-build-abc'], expect.anything()]);
    expect(gitCalls).toContainEqual([
      'git',
      ['-C', '/tmp/mediforce-build-abc', 'fetch', '/tmp/test-repo.git', 'abc123', '--depth', '1'],
      expect.anything(),
    ]);
    expect(gitCalls).toContainEqual([
      'git',
      ['-C', '/tmp/mediforce-build-abc', 'checkout', 'FETCH_HEAD'],
      expect.anything(),
    ]);

    // Should docker build with the commit label
    const args = buildArgs();
    expect(args).toContain('test-image');
    expect(args).toContain('mediforce.build.commit=abc123');

    // Should cleanup temp dir
    expect(rmMock).toHaveBeenCalledWith('/tmp/mediforce-build-abc', { recursive: true, force: true });
  });

  it('uses custom dockerfile path when provided', async () => {
    execSyncMock.mockReturnValue(Buffer.from(''));

    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: '/tmp/test-repo.git',
      commit: 'abc123',
      dockerfile: 'container/Dockerfile',
    });

    const args = buildArgs();
    expect(args).toContain('/tmp/mediforce-build-abc/container/Dockerfile');
    expect(buildLabel(args, 'mediforce.build.dockerfile')).toBe('container/Dockerfile');
  });

  it('labels no dockerfile when the step named none, matching what the tag hashed', async () => {
    execSyncMock.mockReturnValue(Buffer.from(''));

    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: '/tmp/test-repo.git',
      commit: 'abc123',
    });

    const args = buildArgs();
    // The build still needs a concrete path...
    expect(args).toContain('/tmp/mediforce-build-abc/Dockerfile');
    // ...but `deriveBuildTag` hashed `dockerfile ?? ''`, so labelling the
    // resolved default would make the image claim a Dockerfile its own tag
    // never saw, and an Image Catalog entry keyed on `(repo, dockerfile)`
    // could not match it (ADR-0021 decision 1).
    expect(buildLabel(args, 'mediforce.build.dockerfile')).toBeUndefined();
  });

  it('labels the image with repo, workflow, namespace and the OCI equivalents', async () => {
    execSyncMock.mockReturnValue(Buffer.from(''));

    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: 'git@github.com:owner/repo.git',
      commit: 'abc123',
      dockerfile: 'container/Dockerfile',
      workflow: 'sdtm-mapping',
      namespace: 'acme',
    });

    const args = buildArgs();
    expect(buildLabel(args, 'mediforce.build.repo')).toBe('git@github.com:owner/repo.git');
    expect(buildLabel(args, 'mediforce.build.commit')).toBe('abc123');
    expect(buildLabel(args, 'mediforce.build.dockerfile')).toBe('container/Dockerfile');
    expect(buildLabel(args, 'mediforce.build.workflow')).toBe('sdtm-mapping');
    expect(buildLabel(args, 'mediforce.build.namespace')).toBe('acme');
    // Overriding the inherited OCI labels — without this the image reports its
    // base image's repository as its own source.
    expect(buildLabel(args, 'org.opencontainers.image.source')).toBe('https://github.com/owner/repo');
    expect(buildLabel(args, 'org.opencontainers.image.revision')).toBe('abc123');
  });

  it('keeps a clone token out of the repo label', async () => {
    execSyncMock.mockReturnValue(Buffer.from(''));

    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: 'https://x-access-token:SECRET@github.com/owner/private.git',
      commit: 'abc123',
      repoToken: 'SECRET',
    });

    expect(buildArgs()?.join(' ')).not.toContain('SECRET');
  });

  it('defaults to Dockerfile in repo root', async () => {
    execSyncMock.mockReturnValue(Buffer.from(''));

    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: '/tmp/test-repo.git',
      commit: 'abc123',
    });

    const args = buildArgs();
    expect(args).toBeDefined();
    // Should use Dockerfile (default) — the -f flag should reference repo root Dockerfile
    expect(args?.[args.indexOf('-f') + 1]).toBe('/tmp/mediforce-build-abc/Dockerfile');
  });

  it('clones a public owner/repo ref over anonymous HTTPS without a deploy key', async () => {
    execSyncMock.mockReturnValue(Buffer.from(''));

    await buildImageFromRepo({
      image: 'test-image',
      // repoUrl keeps the SSH-normalized form (cache-tag identity).
      repoUrl: 'git@github.com:owner/repo.git',
      // repoRef carries the user-supplied shorthand so the transport is decided from it.
      repoRef: 'owner/repo',
      commit: 'abc123',
    });

    const [command, args, options] = fetchCalls()[0];
    // Anonymous HTTPS — no token, no SSH.
    expect(command).toBe('git');
    expect(args).toEqual([
      '-C', '/tmp/mediforce-build-abc', 'fetch', 'https://github.com/owner/repo', 'abc123', '--depth', '1',
    ]);
    // No GIT_SSH_COMMAND for an anonymous HTTPS clone — the deploy key is never referenced.
    expect(options?.env?.GIT_SSH_COMMAND).toBeUndefined();
  });

  it('clones a git@ ref over SSH and sets GIT_SSH_COMMAND', async () => {
    execSyncMock.mockReturnValue(Buffer.from(''));

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

  it('cleans up temp dir even on build failure', async () => {
    execFileSyncMock.mockImplementation((command, args) => {
      // Fail on docker build (after git commands succeed)
      if (command === 'docker' && args?.[0] === 'build') throw new Error('docker build failed');
      return Buffer.from('');
    });

    await expect(
      buildImageFromRepo({
        image: 'test-image',
        repoUrl: '/tmp/test-repo.git',
        commit: 'abc123',
      }),
    ).rejects.toThrow('docker build failed');

    expect(rmMock).toHaveBeenCalledWith('/tmp/mediforce-build-abc', { recursive: true, force: true });
  });
});

describe('ensureImage', () => {
  it('skips build when image exists with same commit', async () => {
    // imageExistsLocally → true
    execSyncMock.mockReturnValueOnce(Buffer.from(''));
    // getImageBuildCommit → same commit
    execSyncMock.mockReturnValueOnce(Buffer.from('abc123\n'));

    await ensureImage({
      image: 'test-image',
      repoUrl: '/tmp/repo.git',
      commit: 'abc123',
    });

    // No git or docker build commands should follow
    expect(execSyncMock).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when image exists with different commit', async () => {
    // imageExistsLocally → true
    execSyncMock.mockReturnValueOnce(Buffer.from(''));
    // getImageBuildCommit → different commit
    execSyncMock.mockReturnValueOnce(Buffer.from('old-commit\n'));
    // buildImageFromRepo calls
    execSyncMock.mockReturnValue(Buffer.from(''));

    await ensureImage({
      image: 'test-image',
      repoUrl: '/tmp/repo.git',
      commit: 'new-commit',
    });

    expect(buildArgs()).toBeDefined();
  });

  it('builds when image does not exist and repo+commit provided', async () => {
    // imageExistsLocally → false
    execSyncMock.mockImplementationOnce(() => {
      throw new Error('No such image');
    });
    // buildImageFromRepo calls
    execSyncMock.mockReturnValue(Buffer.from(''));

    await ensureImage({
      image: 'test-image',
      repoUrl: '/tmp/repo.git',
      commit: 'abc123',
    });

    expect(buildArgs()).toBeDefined();
  });

  it('throws when image missing and no repo+commit', async () => {
    // imageExistsLocally → false
    execSyncMock.mockImplementationOnce(() => {
      throw new Error('No such image');
    });

    await expect(
      ensureImage({ image: 'test-image' }),
    ).rejects.toThrow(/not found locally.*no repo.*commit/i);
  });

  it('succeeds when image exists and no repo+commit (no stale check possible)', async () => {
    // imageExistsLocally → true
    execSyncMock.mockReturnValueOnce(Buffer.from(''));

    await ensureImage({ image: 'test-image' });

    // Only the one inspect call
    expect(execSyncMock).toHaveBeenCalledTimes(1);
  });
});
