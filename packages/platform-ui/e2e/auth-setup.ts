import * as fs from 'node:fs';
import * as path from 'node:path';
import { test as setup } from '@playwright/test';
import { TEST_USER_ID } from './helpers/constants';
import { openPostgresClient, seedAuthSession } from './helpers/auth-session';
import { seedPostgresNamespace } from './helpers/postgres-seed';

/** Read the mock OAuth server's base URL that globalSetup wrote. Falls back
 *  to a placeholder when running without globalSetup (e.g. CI lanes that
 *  skip it). Journey tests that rely on the mock will fail loudly in that
 *  case — the URL is written only when the mock server started. */
function readMockOAuthBaseUrl(): string {
  const file = path.join(__dirname, '.mock-oauth-url');
  if (!fs.existsSync(file)) return 'http://127.0.0.1:0';
  return fs.readFileSync(file, 'utf8').trim();
}

const TEST_EMAIL = 'test@mediforce.dev';
const TEST_DISPLAY_NAME = 'Test User';

// The session cookie name for database-strategy NextAuth over http (see
// packages/platform-ui/src/lib/session-cookie.ts). Its value is the
// `auth_sessions.session_token` verbatim. `__Secure-` is only prefixed over
// https; the E2E server is plain http on localhost.
const SESSION_COOKIE_NAME = 'authjs.session-token';

// The cookie domain must match the Playwright `baseURL` host (localhost) for
// the browser to attach it — a 127.0.0.1 cookie would never be sent to a
// localhost origin.
const COOKIE_DOMAIN = 'localhost';

const STORAGE_STATE_PATH = 'e2e/.auth/user.json';

setup('authenticate and seed data', async () => {
  // Postgres seed round trips plus the first-run Next.js compilation on the
  // shared server can eat well past the default 30s test timeout. Raise to
  // 120s so the setup is not flaky.
  setup.setTimeout(120_000);

  // 1. Seed Postgres — the server-side data layer (user profiles, processes,
  // instances, tasks, audits, agent runs, cowork, model registry, tool
  // catalog, oauth, agent defs, namespaces + members) lives entirely in
  // Postgres. `seedPostgresNamespace` writes the full fixture (workspaces,
  // members, workflow definitions, …) keyed to the stable test user id so
  // server-side handlers can resolve `?namespace=test`. The mock OAuth base
  // URL (written by globalSetup) is threaded into the seeded `github-mock`
  // provider so the per-agent OAuth journey connects through the mock.
  await seedPostgresNamespace(TEST_USER_ID, { mockOAuthBaseUrl: readMockOAuthBaseUrl() });

  // 2. Seed the NextAuth `auth_users` row + a database session for the test
  // user, then persist the session token as the Playwright storage-state
  // cookie. This replaces the old Firebase emulator sign-in + `/test-login`
  // navigation — the cookie alone authenticates every downstream journey.
  const { client, db } = openPostgresClient();
  let sessionToken: string;
  try {
    sessionToken = await seedAuthSession(db, {
      userId: TEST_USER_ID,
      email: TEST_EMAIL,
      name: TEST_DISPLAY_NAME,
    });
  } finally {
    await client.end({ timeout: 5 });
  }

  // 3. Write the Playwright storageState with the session cookie.
  const expires = Math.floor((Date.now() + 1000 * 60 * 60 * 24 * 30) / 1000);
  const storageState = {
    cookies: [
      {
        name: SESSION_COOKIE_NAME,
        value: sessionToken,
        domain: COOKIE_DOMAIN,
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
        expires,
      },
    ],
    origins: [] as const,
  };
  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
  fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify(storageState, null, 2), 'utf8');
});
