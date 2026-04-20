import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'prepare-deploy-key-test-'));
  tmpDirs.push(dir);
  return dir;
}

async function importFresh() {
  vi.resetModules();
  return import('../container-plugin.js');
}

beforeEach(() => {
  delete process.env.DEPLOY_KEY_PATH;
});

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('prepareDeployKeyPath', () => {
  it('returns source path unchanged when source does not exist', async () => {
    const missing = join(makeTmpDir(), 'does-not-exist');
    process.env.DEPLOY_KEY_PATH = missing;

    const { prepareDeployKeyPath } = await importFresh();
    const result = prepareDeployKeyPath();

    expect(result).toBe(missing);
    expect(existsSync(result)).toBe(false);
  });

  it('copies key to a fresh tmp file with 0600 perms when source exists', async () => {
    const sourceDir = makeTmpDir();
    const source = join(sourceDir, 'deploy_key');
    writeFileSync(source, 'PRIVATE-KEY-CONTENTS', { mode: 0o644 });
    process.env.DEPLOY_KEY_PATH = source;

    const { prepareDeployKeyPath } = await importFresh();
    const result = prepareDeployKeyPath();
    tmpDirs.push(result);

    expect(result).not.toBe(source);
    expect(existsSync(result)).toBe(true);
    expect(readFileSync(result, 'utf8')).toBe('PRIVATE-KEY-CONTENTS');
    // Mask to permission bits — statSync returns full mode incl. file type.
    expect(statSync(result).mode & 0o777).toBe(0o600);
  });

  it('caches the prepared path across calls (does not re-copy)', async () => {
    const sourceDir = makeTmpDir();
    const source = join(sourceDir, 'deploy_key');
    writeFileSync(source, 'KEY', { mode: 0o644 });
    process.env.DEPLOY_KEY_PATH = source;

    const { prepareDeployKeyPath } = await importFresh();
    const first = prepareDeployKeyPath();
    const second = prepareDeployKeyPath();

    expect(second).toBe(first);
  });
});
