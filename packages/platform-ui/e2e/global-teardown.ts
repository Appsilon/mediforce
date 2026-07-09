import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FullConfig } from '@playwright/test';

const OAUTH_URL_FILE = path.join(__dirname, '.mock-oauth-url');

async function globalTeardown(_config: FullConfig): Promise<void> {
  try {
    await globalThis.__mockOAuthHandle?.stop();
  } catch (err: unknown) {
    // eslint-disable-next-line no-console
    console.warn(`[global-teardown] mock OAuth server stop failed: ${String(err)}`);
  }
  try {
    fs.rmSync(OAUTH_URL_FILE, { force: true });
  } catch {
    // non-fatal
  }
  const proc = globalThis.__firebaseEmulatorProcess;
  if (proc?.pid !== undefined && !proc.killed) {
    try {
      // Kill the entire process group so the JVM child process also exits.
      process.kill(-proc.pid, 'SIGTERM');
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.warn(`[global-teardown] Firebase emulator stop failed: ${String(err)}`);
    }
  }
}

export default globalTeardown;
