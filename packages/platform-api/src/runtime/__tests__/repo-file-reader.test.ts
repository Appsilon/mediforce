import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cloneMock = vi.hoisted(() => vi.fn());
vi.mock('@mediforce/agent-runtime', () => ({ cloneRepoAtCommit: cloneMock }));

const { createGitRepoFileReader } = await import('../repo-file-reader');

let secretsDir: string;

beforeEach(() => {
  secretsDir = mkdtempSync(join(tmpdir(), 'reader-secrets-'));
  writeFileSync(join(secretsDir, 'id_rsa'), 'PRIVATE KEY MATERIAL\n');
});

afterEach(() => {
  rmSync(secretsDir, { recursive: true, force: true });
  cloneMock.mockReset();
});

/** Stands in for the checkout `cloneRepoAtCommit` would have produced. */
function checkoutContaining(build: (dir: string) => void): void {
  cloneMock.mockImplementation((targetDir: string) => { build(targetDir); });
}

describe('createGitRepoFileReader', () => {
  it('reads a named file', async () => {
    checkoutContaining((dir) => writeFileSync(join(dir, 'Dockerfile'), 'FROM r-base\n'));
    const files = await createGitRepoFileReader().read({
      repo: 'org/repo', commit: 'c'.repeat(40), paths: ['Dockerfile'], maxBytes: 1024,
    });
    expect(files).toEqual([{ path: 'Dockerfile', contents: 'FROM r-base\n' }]);
  });

  it('refuses a symlink, which git materialises and readFileSync would follow off the checkout', async () => {
    const target = join(secretsDir, 'id_rsa');
    checkoutContaining((dir) => symlinkSync(target, join(dir, 'Dockerfile')));
    const files = await createGitRepoFileReader().read({
      repo: 'org/repo', commit: 'c'.repeat(40), paths: ['Dockerfile'], maxBytes: 1024,
    });
    expect(files).toEqual([]);
  });

  it('refuses a path that climbs out of the checkout', async () => {
    checkoutContaining((dir) => mkdirSync(join(dir, 'sub'), { recursive: true }));
    const files = await createGitRepoFileReader().read({
      repo: 'org/repo', commit: 'c'.repeat(40), paths: ['../../etc/passwd'], maxBytes: 1024,
    });
    expect(files).toEqual([]);
  });

  it('truncates on a character boundary rather than splitting one in half', async () => {
    // Four bytes of two-byte characters; a cut at 3 would leave half of one.
    checkoutContaining((dir) => writeFileSync(join(dir, 'notes.md'), 'éé'));
    const [file] = await createGitRepoFileReader().read({
      repo: 'org/repo', commit: 'c'.repeat(40), paths: ['notes.md'], maxBytes: 3,
    });
    expect(file.truncated).toBe(true);
    expect(file.contents).toBe('é');
  });

  it('deletes the checkout even when reading throws', async () => {
    let checkoutDir = '';
    cloneMock.mockImplementation((dir: string) => {
      checkoutDir = dir;
      throw new Error('fetch failed');
    });
    await expect(createGitRepoFileReader().read({
      repo: 'org/repo', commit: 'c'.repeat(40), paths: ['Dockerfile'], maxBytes: 1024,
    })).rejects.toThrow('fetch failed');
    const { existsSync } = await import('node:fs');
    expect(existsSync(checkoutDir)).toBe(false);
  });
});
