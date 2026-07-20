import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..', '..');
const binPath = path.join(packageRoot, 'bin', 'mediforce.cjs');

const requireFromPackage = createRequire(path.join(packageRoot, 'package.json'));
let tsxResolvable = true;
try {
  requireFromPackage.resolve('tsx/cli');
} catch {
  tsxResolvable = false;
}

function runBin(args: string[]) {
  return spawnSync(process.execPath, [binPath, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, MEDIFORCE_API_KEY: 'test-key' },
  });
}

// Each case spawns a real `node + tsx + CLI` subprocess (~2s solo), so the
// default 5s per-test timeout is too tight once the full monorepo suite runs
// its packages in parallel and saturates CPU.
describe.skipIf(!tsxResolvable)('bin shim — spawned process', { timeout: 20_000 }, () => {
  it('--help exits 0 and prints usage on stdout', () => {
    const result = runBin(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Usage: mediforce/);
  });

  it('missing positional (`run get`) exits 2 with a stderr error', () => {
    const result = runBin(['run', 'get']);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Missing required positional argument: RUNID/);
  });

  it('unknown command exits 2 with a stderr error', () => {
    const result = runBin(['unknown-cmd']);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Unknown command/);
  });
});
