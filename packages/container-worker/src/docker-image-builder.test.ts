import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  mkdtemp: vi.fn(),
  rm: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { buildImageFromRepo } from './docker-image-builder';

const execSyncMock = vi.mocked(execSync);
const mkdtempMock = vi.mocked(mkdtemp);
const rmMock = vi.mocked(rm);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DEPLOY_KEY_PATH;
  mkdtempMock.mockResolvedValue('/tmp/mediforce-worker-build-abc');
  rmMock.mockResolvedValue(undefined);
  execSyncMock.mockReturnValue(Buffer.from(''));
});

afterEach(() => {
  delete process.env.DEPLOY_KEY_PATH;
});

/** git fetch invocations in call order — one per attempted clone transport. */
function fetchCalls(): Parameters<typeof execSync>[] {
  return execSyncMock.mock.calls.filter(([command]) => String(command).includes(' fetch '));
}

describe('container-worker buildImageFromRepo', () => {
  it('uses anonymous HTTPS for owner/repo shorthand without a deploy key', async () => {
    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: 'git@github.com:owner/repo.git',
      repoRef: 'owner/repo',
      commit: 'abc123',
    });

    const [command, options] = fetchCalls()[0];
    expect(String(command)).toContain('https://github.com/owner/repo');
    expect(options?.env?.GIT_SSH_COMMAND).toBeUndefined();
  });

  it('uses SSH for git@ refs', async () => {
    await buildImageFromRepo({
      image: 'test-image',
      repoUrl: 'git@github.com:owner/repo.git',
      repoRef: 'git@github.com:owner/repo.git',
      commit: 'abc123',
    });

    const [command, options] = fetchCalls()[0];
    expect(String(command)).toContain('git@github.com:owner/repo.git');
    expect(options?.env?.GIT_SSH_COMMAND).toContain('ssh -i');
  });

  it('falls back to the SSH deploy key when anonymous HTTPS cannot see a private owner/repo', async () => {
    execSyncMock.mockImplementation((command) => {
      if (String(command).includes('fetch "https://github.com/owner/private"')) {
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
    const [command, options] = fetches[1];
    expect(String(command)).toContain('git@github.com:owner/private.git');
    expect(options?.env?.GIT_SSH_COMMAND).toContain('ssh -i');
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
