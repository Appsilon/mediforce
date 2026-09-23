import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { createGitRepoFileReader, parseTreeListing } = await import('../repo-file-reader');

let secretsDir: string;

beforeEach(() => {
  secretsDir = mkdtempSync(join(tmpdir(), 'reader-secrets-'));
  writeFileSync(join(secretsDir, 'id_rsa'), 'PRIVATE KEY MATERIAL\n');
});

afterEach(() => {
  rmSync(secretsDir, { recursive: true, force: true });
});

/**
 * These run against real `git`, not a mocked checkout: the reads are `git show`
 * against the object store rather than the filesystem, and whether that can be
 * made to escape is a property of git, not of code we could stub.
 */
describe('createGitRepoFileReader', () => {
  let origin: string;
  let commit: string;

  beforeEach(() => {
    origin = mkdtempSync(join(tmpdir(), 'reader-origin-'));
    const git = (...args: string[]): void => {
      execFileSync('git', ['-C', origin, ...args], { stdio: 'pipe' });
    };
    execFileSync('git', ['init', '-q', origin], { stdio: 'pipe' });
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    writeFileSync(join(origin, 'Dockerfile'), 'FROM r-base\n');
    mkdirSync(join(origin, 'container'), { recursive: true });
    writeFileSync(join(origin, 'container', 'run.py'), 'print(1)\n');
    symlinkSync(join(secretsDir, 'id_rsa'), join(origin, 'key-link'));
    git('add', '-A');
    git('commit', '-qm', 'fixture');
    commit = execFileSync('git', ['-C', origin, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  });

  afterEach(() => rmSync(origin, { recursive: true, force: true }));

  it('lists every file in the commit without reading any of them', async () => {
    const entries = await createGitRepoFileReader().list({ repo: origin, commit });
    expect(entries.map((entry) => entry.path).sort())
      .toEqual(['Dockerfile', 'container/run.py', 'key-link']);
  });

  it('opens a file by path', async () => {
    const file = await createGitRepoFileReader()
      .open({ repo: origin, commit, path: 'container/run.py', maxBytes: 1024 });
    expect(file).toEqual({ path: 'container/run.py', contents: 'print(1)\n' });
  });

  it('is null for a path the commit does not hold', async () => {
    const file = await createGitRepoFileReader()
      .open({ repo: origin, commit, path: 'nope.txt', maxBytes: 1024 });
    expect(file).toBeNull();
  });

  it('reads a symlink as its target path, never the file it points at', async () => {
    // git stores a symlink as a blob holding the target path, so `git show`
    // returns that text. The private key it points at stays unread.
    const file = await createGitRepoFileReader()
      .open({ repo: origin, commit, path: 'key-link', maxBytes: 1024 });
    expect(file).toMatchObject({ path: 'key-link' });
    expect((file as { contents: string }).contents).not.toContain('PRIVATE KEY MATERIAL');
    expect((file as { contents: string }).contents).toContain('id_rsa');
  });

  it('cannot be walked out of the repository', async () => {
    const file = await createGitRepoFileReader()
      .open({ repo: origin, commit, path: '../../etc/passwd', maxBytes: 1024 });
    expect(file).toBeNull();
  });

  it('refuses a file past the cap instead of returning part of it', async () => {
    const file = await createGitRepoFileReader()
      .open({ repo: origin, commit, path: 'Dockerfile', maxBytes: 4 });
    expect(file).toEqual({ path: 'Dockerfile', maxBytes: 4, tooLarge: true });
  });

  it('deletes the checkout even when the clone throws', async () => {
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith('mediforce-tree-')).length;
    await expect(createGitRepoFileReader().list({ repo: origin, commit: 'f'.repeat(40) }))
      .rejects.toThrow();
    const after = readdirSync(tmpdir()).filter((name) => name.startsWith('mediforce-tree-')).length;
    expect(after).toBe(before);
  });
});

describe('parseTreeListing', () => {
  it('reads paths, including ones with spaces', () => {
    const stdout = [
      '100644 blob a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2\tDockerfile',
      '100644 blob 0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f\tfixtures/adverse events.csv',
    ].join('\n');

    expect(parseTreeListing(stdout)).toEqual([
      { path: 'Dockerfile' },
      { path: 'fixtures/adverse events.csv' },
    ]);
  });

  it('leaves out submodules, which have nothing here to open', () => {
    const stdout = [
      '160000 commit 1111111111111111111111111111111111111111\tvendor/lib',
      '100644 blob 2222222222222222222222222222222222222222\tREADME.md',
    ].join('\n');

    expect(parseTreeListing(stdout)).toEqual([{ path: 'README.md' }]);
  });

  it('ignores a listing that still carries sizes, which a treeless clone cannot produce', () => {
    // `-l` output. Accepting it would mean the caller asked git for sizes and
    // paid a fetch of every blob to get them.
    const stdout = '100644 blob a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2     412\tDockerfile';
    expect(parseTreeListing(stdout)).toEqual([]);
  });

  it('is empty for an empty listing', () => {
    expect(parseTreeListing('')).toEqual([]);
    expect(parseTreeListing('\n')).toEqual([]);
  });
});
