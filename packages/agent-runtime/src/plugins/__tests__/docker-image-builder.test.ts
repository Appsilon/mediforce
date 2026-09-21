import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
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

import { execFileSync, spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import {
  imageExistsLocally,
  getImageBuildCommit,
  buildImageFromRepo,
  ensureImage,
} from '../docker-image-builder';

const execFileSyncMock = vi.mocked(execFileSync);
const mkdtempMock = vi.mocked(mkdtemp);
const rmMock = vi.mocked(rm);
const realpathSyncMock = vi.mocked(realpathSync);

beforeEach(() => {
  vi.clearAllMocks();
  realpathSyncMock.mockImplementation((path) => String(path));
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
    execFileSyncMock.mockReturnValueOnce(Buffer.from(''));
    const result = await imageExistsLocally('my-image:latest');
    expect(result).toBe(true);
    expect(execFileSyncMock).toHaveBeenCalledWith(
      'docker',
      ['image', 'inspect', 'my-image:latest'],
      expect.anything(),
    );
  });

  it('returns false when docker image inspect fails', async () => {
    execFileSyncMock.mockImplementationOnce(() => {
      throw new Error('No such image');
    });
    const result = await imageExistsLocally('missing-image');
    expect(result).toBe(false);
  });
});

describe('getImageBuildCommit', () => {
  it('returns commit SHA from image label', async () => {
    execFileSyncMock.mockReturnValueOnce(Buffer.from('abc123def456\n'));
    const result = await getImageBuildCommit('my-image');
    expect(result).toBe('abc123def456');
  });

  it('returns null when image has no build label', async () => {
    execFileSyncMock.mockReturnValueOnce(Buffer.from('\n'));
    const result = await getImageBuildCommit('my-image');
    expect(result).toBeNull();
  });

  it('returns null when docker inspect fails', async () => {
    execFileSyncMock.mockImplementationOnce(() => {
      throw new Error('No such image');
    });
    const result = await getImageBuildCommit('missing-image');
    expect(result).toBeNull();
  });
});

describe('buildImageFromRepo', () => {
  it('clones repo at specific commit and runs docker build', async () => {
    // All Docker and Git calls succeed
    execFileSyncMock.mockReturnValue(Buffer.from(''));

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
    execFileSyncMock.mockReturnValue(Buffer.from(''));

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
    execFileSyncMock.mockReturnValue(Buffer.from(''));

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
    // could not match it (ADR-0022 decision 1).
    expect(buildLabel(args, 'mediforce.build.dockerfile')).toBeUndefined();
  });

  it('labels the image with repo, workflow, namespace and the OCI equivalents', async () => {
    execFileSyncMock.mockReturnValue(Buffer.from(''));

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
    execFileSyncMock.mockReturnValue(Buffer.from(''));

    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: 'https://x-access-token:SECRET@github.com/owner/private.git',
      commit: 'abc123',
      repoToken: 'SECRET',
    });

    expect(buildArgs()?.join(' ')).not.toContain('SECRET');
  });

  it('defaults to Dockerfile in repo root', async () => {
    execFileSyncMock.mockReturnValue(Buffer.from(''));

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

  it('builds from the Dockerfile\'s own directory when no context is named', async () => {
    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: '/tmp/test-repo.git',
      commit: 'abc123',
      dockerfile: 'container/Dockerfile',
    });

    expect(buildArgs()?.at(-1)).toBe('/tmp/mediforce-build-abc/container');
  });

  it('builds from the named context, resolving the Dockerfile from it', async () => {
    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: '/tmp/test-repo.git',
      commit: 'abc123',
      dockerfile: 'container/Dockerfile',
      context: '.',
    });

    const args = buildArgs();
    expect(args?.[(args?.indexOf('-f') ?? 0) + 1]).toBe('/tmp/mediforce-build-abc/container/Dockerfile');
    // The repo root — so `COPY scripts/` in container/Dockerfile resolves.
    expect(args?.at(-1)).toBe('/tmp/mediforce-build-abc');
    expect(buildLabel(args, 'mediforce.build.context')).toBe('.');
    expect(buildLabel(args, 'mediforce.build.dockerfile')).toBe('container/Dockerfile');
  });

  it('refuses a context the checkout symlinks outside the clone, before building', async () => {
    realpathSyncMock.mockImplementation((path) =>
      String(path) === '/tmp/mediforce-build-abc/ctx' ? '/' : String(path),
    );

    await expect(
      buildImageFromRepo({
        image: 'test-image',
        repoUrl: '/tmp/test-repo.git',
        commit: 'abc123',
        dockerfile: '../Dockerfile',
        context: 'ctx',
      }),
    ).rejects.toThrow(/outside the repository/);

    expect(buildArgs()).toBeUndefined();
    expect(rmMock).toHaveBeenCalledWith('/tmp/mediforce-build-abc', { recursive: true, force: true });
  });

  it('refuses a context outside the clone before cloning anything', async () => {
    await expect(
      buildImageFromRepo({
        image: 'test-image',
        repoUrl: '/tmp/test-repo.git',
        commit: 'abc123',
        dockerfile: 'Dockerfile',
        context: '../../..',
      }),
    ).rejects.toThrow(/outside the repository/);

    expect(fetchCalls()).toHaveLength(0);
    expect(buildArgs()).toBeUndefined();
  });

  it('clones a public owner/repo ref over anonymous HTTPS without a deploy key', async () => {
    execFileSyncMock.mockReturnValue(Buffer.from(''));

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

  it('clones a non-GitHub git@ ref over SSH and sets GIT_SSH_COMMAND', async () => {
    execFileSyncMock.mockReturnValue(Buffer.from(''));

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
    execFileSyncMock.mockReturnValueOnce(Buffer.from(''));
    // getImageBuildCommit → same commit
    execFileSyncMock.mockReturnValueOnce(Buffer.from('abc123\n'));

    await ensureImage({
      image: 'test-image',
      repoUrl: '/tmp/repo.git',
      commit: 'abc123',
    });

    // No git or docker build commands should follow
    expect(execFileSyncMock).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when image exists with different commit', async () => {
    // imageExistsLocally → true
    execFileSyncMock.mockReturnValueOnce(Buffer.from(''));
    // getImageBuildCommit → different commit
    execFileSyncMock.mockReturnValueOnce(Buffer.from('old-commit\n'));
    // buildImageFromRepo calls
    execFileSyncMock.mockReturnValue(Buffer.from(''));

    await ensureImage({
      image: 'test-image',
      repoUrl: '/tmp/repo.git',
      commit: 'new-commit',
    });

    expect(buildArgs()).toBeDefined();
  });

  it('builds when image does not exist and repo+commit provided', async () => {
    // imageExistsLocally → false
    execFileSyncMock.mockImplementationOnce(() => {
      throw new Error('No such image');
    });
    // buildImageFromRepo calls
    execFileSyncMock.mockReturnValue(Buffer.from(''));

    await ensureImage({
      image: 'test-image',
      repoUrl: '/tmp/repo.git',
      commit: 'abc123',
    });

    expect(buildArgs()).toBeDefined();
  });

  it('throws when image missing and no repo+commit', async () => {
    // imageExistsLocally → false
    execFileSyncMock.mockImplementationOnce(() => {
      throw new Error('No such image');
    });

    await expect(
      ensureImage({ image: 'test-image' }),
    ).rejects.toThrow(/not found locally.*no repo.*commit/i);
  });

  it('succeeds when image exists and no repo+commit (no stale check possible)', async () => {
    // imageExistsLocally → true
    execFileSyncMock.mockReturnValueOnce(Buffer.from(''));

    await ensureImage({ image: 'test-image' });

    // Only the one inspect call
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
  });
});

// A workflow that carries its own Dockerfile has a build context on disk
// already — the files were materialized for the /artifacts mount — so the
// builder must not clone anything to find one.
describe('ensureImage — building from a directory the workflow carries', () => {
  it('builds from the given directory, with no clone at all', async () => {
    execFileSyncMock.mockImplementationOnce(() => { throw new Error('No such image'); }); // inspect

    await ensureImage({
      image: 'mediforce-artifacts:abc123',
      contextDir: '/tmp/mediforce-artifacts/abc123',
      dockerfile: 'Dockerfile',
      artifactsHash: 'abc123',
    });

    expect(fetchCalls()).toHaveLength(0);
    expect(mkdtempMock).not.toHaveBeenCalled();
    const args = buildArgs();
    expect(args).toEqual(expect.arrayContaining(['-f', '/tmp/mediforce-artifacts/abc123/Dockerfile']));
    expect(args?.at(-1)).toBe('/tmp/mediforce-artifacts/abc123');
  });

  it('keeps the whole carried set as the context, so `COPY scripts/` works from `container/Dockerfile`', async () => {
    execFileSyncMock.mockImplementationOnce(() => { throw new Error('No such image'); });

    await ensureImage({
      image: 'mediforce-artifacts:abc123',
      contextDir: '/tmp/mediforce-artifacts/abc123',
      dockerfile: 'container/Dockerfile',
      artifactsHash: 'abc123',
    });

    const args = buildArgs();
    expect(args).toEqual(expect.arrayContaining(['-f', '/tmp/mediforce-artifacts/abc123/container/Dockerfile']));
    expect(args?.at(-1)).toBe('/tmp/mediforce-artifacts/abc123');
  });

  it('builds from every carried file even when the job names a context, keeping the Dockerfile path as written', async () => {
    execFileSyncMock.mockImplementationOnce(() => { throw new Error('No such image'); });

    // A job queued by an older engine may still carry the step's `context`.
    await ensureImage({
      image: 'mediforce-artifacts:abc123',
      contextDir: '/tmp/mediforce-artifacts/abc123',
      dockerfile: 'container/Dockerfile',
      context: 'container',
      artifactsHash: 'abc123',
    });

    const args = buildArgs();
    expect(args).toEqual(expect.arrayContaining(['-f', '/tmp/mediforce-artifacts/abc123/container/Dockerfile']));
    expect(args?.at(-1)).toBe('/tmp/mediforce-artifacts/abc123');
    expect(buildLabel(args, 'mediforce.build.dockerfile')).toBe('container/Dockerfile');
    expect(buildLabel(args, 'mediforce.build.context')).toBe('');
  });

  it('labels the image with the content it was built from', async () => {
    execFileSyncMock.mockImplementationOnce(() => { throw new Error('No such image'); });

    await ensureImage({
      image: 'mediforce-artifacts:abc123',
      contextDir: '/ctx',
      artifactsHash: 'abc123',
      workflow: 'wf',
      namespace: 'acme',
    });

    expect(buildLabel(buildArgs(), 'mediforce.build.artifacts')).toBe('abc123');
    expect(buildLabel(buildArgs(), 'mediforce.build.workflow')).toBe('wf');
    expect(buildLabel(buildArgs(), 'mediforce.build.namespace')).toBe('acme');
  });

  it('does not rebuild an image already built from these files', async () => {
    execFileSyncMock.mockReturnValueOnce(Buffer.from('')); // inspect succeeds
    execFileSyncMock.mockReturnValueOnce(Buffer.from('abc123\n')); // artifacts label

    await ensureImage({
      image: 'my-registry/mine:v2',
      contextDir: '/tmp/mediforce-artifacts/abc123',
      artifactsHash: 'abc123',
    });

    expect(buildArgs()).toBeUndefined();
  });

  it('rebuilds an image the step named once the files it was built from change', async () => {
    // The step pinned its own tag, so the tag no longer says which files are in
    // it: the label does, and an edited Dockerfile or script must reach the run.
    execFileSyncMock.mockReturnValueOnce(Buffer.from('')); // inspect succeeds
    execFileSyncMock.mockReturnValueOnce(Buffer.from('old000hash00\n')); // artifacts label

    await ensureImage({
      image: 'my-registry/mine:v2',
      contextDir: '/tmp/mediforce-artifacts/new',
      artifactsHash: 'new111hash11',
    });

    expect(buildArgs()?.at(-1)).toBe('/tmp/mediforce-artifacts/new');
    expect(buildLabel(buildArgs(), 'mediforce.build.artifacts')).toBe('new111hash11');
  });

  it('rebuilds an image that carries no content label at all', async () => {
    execFileSyncMock.mockReturnValueOnce(Buffer.from('')); // inspect succeeds
    execFileSyncMock.mockReturnValueOnce(Buffer.from('\n')); // no label

    await ensureImage({ image: 'my-registry/mine:v2', contextDir: '/ctx', artifactsHash: 'abc123' });

    expect(buildArgs()).toBeDefined();
  });

  it('reuses an existing image for a job queued before the content hash existed', async () => {
    // A job enqueued by an orchestrator older than the label carries no hash:
    // there is nothing to compare, so it behaves as it did then.
    execFileSyncMock.mockReturnValueOnce(Buffer.from('')); // inspect succeeds

    await ensureImage({ image: 'mediforce-artifacts:abc123', contextDir: '/ctx' });

    expect(buildArgs()).toBeUndefined();
  });

  it('builds a missing image for a job queued before the content hash existed', async () => {
    execFileSyncMock.mockImplementationOnce(() => { throw new Error('No such image'); });

    await ensureImage({ image: 'mediforce-artifacts:abc123', contextDir: '/ctx' });

    expect(buildArgs()?.at(-1)).toBe('/ctx');
  });

  it('defaults to a Dockerfile at the root of the set', async () => {
    execFileSyncMock.mockImplementationOnce(() => { throw new Error('No such image'); });

    await ensureImage({ image: 'mediforce-artifacts:abc123', contextDir: '/ctx', artifactsHash: 'abc123' });

    expect(buildArgs()).toEqual(expect.arrayContaining(['-f', '/ctx/Dockerfile']));
  });
});
