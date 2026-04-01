import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  mkdtemp: vi.fn(),
  rm: vi.fn(),
}));

import { execSync, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import {
  imageExistsLocally,
  getImageBuildCommit,
  buildImageFromRepo,
  ensureImage,
} from '../docker-image-builder.js';

const execSyncMock = vi.mocked(execSync);
const mkdtempMock = vi.mocked(mkdtemp);
const rmMock = vi.mocked(rm);

beforeEach(() => {
  vi.clearAllMocks();
  mkdtempMock.mockResolvedValue('/tmp/mediforce-build-abc');
  rmMock.mockResolvedValue(undefined);
});

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
    // All execSync calls succeed
    execSyncMock.mockReturnValue(Buffer.from(''));

    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: '/tmp/test-repo.git',
      commit: 'abc123',
    });

    const calls = execSyncMock.mock.calls.map(([cmd]) => String(cmd));

    // Should init, add remote, fetch commit, checkout (uses git -C <dir> syntax)
    expect(calls.some((cmd) => cmd.includes('git init'))).toBe(true);
    expect(calls.some((cmd) => cmd.includes('remote add origin'))).toBe(true);
    expect(calls.some((cmd) => cmd.includes('fetch origin abc123'))).toBe(true);
    expect(calls.some((cmd) => cmd.includes('checkout FETCH_HEAD'))).toBe(true);

    // Should docker build with label
    expect(calls.some((cmd) =>
      cmd.includes('docker build') &&
      cmd.includes('test-image') &&
      cmd.includes('mediforce.build.commit=abc123'),
    )).toBe(true);

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

    const calls = execSyncMock.mock.calls.map(([cmd]) => String(cmd));
    expect(calls.some((cmd) =>
      cmd.includes('docker build') && cmd.includes('container/Dockerfile'),
    )).toBe(true);
  });

  it('defaults to Dockerfile in repo root', async () => {
    execSyncMock.mockReturnValue(Buffer.from(''));

    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: '/tmp/test-repo.git',
      commit: 'abc123',
    });

    const calls = execSyncMock.mock.calls.map(([cmd]) => String(cmd));
    const buildCmd = calls.find((cmd) => cmd.includes('docker build'));
    expect(buildCmd).toBeDefined();
    // Should use Dockerfile (default) — the -f flag should reference repo root Dockerfile
    expect(buildCmd).toMatch(/-f\s+\S*Dockerfile/);
  });

  it('cleans up temp dir even on build failure', async () => {
    let callCount = 0;
    execSyncMock.mockImplementation(() => {
      callCount++;
      // Fail on docker build (after git commands succeed)
      if (callCount >= 5) throw new Error('docker build failed');
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

    const calls = execSyncMock.mock.calls.map(([cmd]) => String(cmd));
    expect(calls.some((cmd) => cmd.includes('docker build'))).toBe(true);
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

    const calls = execSyncMock.mock.calls.map(([cmd]) => String(cmd));
    expect(calls.some((cmd) => cmd.includes('docker build'))).toBe(true);
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
