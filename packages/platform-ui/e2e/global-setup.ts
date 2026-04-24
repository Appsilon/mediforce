import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FullConfig } from '@playwright/test';
import { startMockOAuthServer, type MockOAuthServerHandle } from './helpers/mock-oauth-server';

/** Written next to this file so both auth-setup and journey tests can read it.
 *  The handle is kept on `globalThis` so globalTeardown can stop the server. */
const OAUTH_URL_FILE = path.join(__dirname, '.mock-oauth-url');

declare global {
  // eslint-disable-next-line no-var
  var __mockOAuthHandle: MockOAuthServerHandle | undefined;
}

async function globalSetup(_config: FullConfig): Promise<void> {
  const handle = await startMockOAuthServer();
  globalThis.__mockOAuthHandle = handle;
  fs.writeFileSync(OAUTH_URL_FILE, handle.baseUrl, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[global-setup] mock OAuth server at ${handle.baseUrl} (url file: ${OAUTH_URL_FILE})`);
}

export default globalSetup;
