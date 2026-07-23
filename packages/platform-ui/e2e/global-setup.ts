import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { FullConfig } from '@playwright/test';
import { startMockOAuthServer, type MockOAuthServerHandle } from './helpers/mock-oauth-server';

/** PATH for spawned tooling (drizzle-kit, pnpm). Homebrew installs these under
 *  /opt/homebrew/bin on Apple Silicon macOS, but that directory is absent on
 *  Linux CI, where pnpm already puts the binaries on PATH — so the prefix is
 *  macOS-only. */
function spawnPath(): string {
  const base = process.env.PATH ?? '';
  return process.platform === 'darwin' ? `/opt/homebrew/bin:${base}` : base;
}

function runMigrations(): void {
  const infraDir = path.resolve(__dirname, '..', '..', '..', 'packages', 'platform-infra');
  const result = spawnSync('pnpm', ['exec', 'drizzle-kit', 'migrate'], {
    cwd: infraDir,
    env: { ...process.env, PATH: spawnPath() },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`[global-setup] db:migrate failed:\n${result.stderr ?? result.stdout}`);
  }
  // eslint-disable-next-line no-console
  console.log('[global-setup] database migrations applied');
}

/** Written next to this file so both auth-setup and journey tests can read it.
 *  The handle is kept on `globalThis` so globalTeardown can stop the server. */
const OAUTH_URL_FILE = path.join(__dirname, '.mock-oauth-url');

declare global {
  // eslint-disable-next-line no-var
  var __mockOAuthHandle: MockOAuthServerHandle | undefined;
}

async function globalSetup(_config: FullConfig): Promise<void> {
  runMigrations();
  const handle = await startMockOAuthServer();
  globalThis.__mockOAuthHandle = handle;
  fs.writeFileSync(OAUTH_URL_FILE, handle.baseUrl, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[global-setup] mock OAuth server at ${handle.baseUrl} (url file: ${OAUTH_URL_FILE})`);
}

export default globalSetup;
