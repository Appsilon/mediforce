import * as fs from 'node:fs';
import * as path from 'node:path';
import { test as setup } from '@playwright/test';
import { TEST_ORG_HANDLE } from './helpers/constants';
import { clearEmulators, createTestUser } from './helpers/emulator';
import { seedPostgresNamespace } from './helpers/postgres-seed';

/** Read the mock OAuth server's base URL that globalSetup wrote. Falls back
 *  to a placeholder when running without globalSetup (e.g. CI lanes that
 *  skip it). Journey tests that rely on the mock will fail loudly in that
 *  case — the URL is written only when NEXT_PUBLIC_USE_EMULATORS=true. */
function readMockOAuthBaseUrl(): string {
  const file = path.join(__dirname, '.mock-oauth-url');
  if (!fs.existsSync(file)) return 'http://127.0.0.1:0';
  return fs.readFileSync(file, 'utf8').trim();
}

const TEST_EMAIL = 'test@mediforce.dev';
const TEST_PASSWORD = 'test123456';
const TEST_DISPLAY_NAME = 'Test User';

setup('authenticate and seed data', async ({ page }) => {
  // First-run Next.js route compilation (test-login + redirect) easily eats
  // 20-30s in a cold dev server, and we still need time for Firebase auth
  // emulator + Postgres seed round trips. The default 30s test timeout races
  // with that. Raise to 120s so the setup is not flaky.
  setup.setTimeout(120_000);

  // 1. Clear Auth emulator state (Firestore is fully removed — ADR-0001 #534)
  await clearEmulators();

  // 2. Create test user and get UID
  const testUserId = await createTestUser(TEST_EMAIL, TEST_PASSWORD, TEST_DISPLAY_NAME);

  // 3. Seed Postgres — the server-side data layer (user profiles, processes,
  // instances, tasks, audits, agent runs, cowork, model registry, tool
  // catalog, oauth, agent defs, namespaces + members) lives entirely in
  // Postgres after the zero-Firestore cutover. `seedPostgresNamespace` writes
  // the full fixture (workspaces, members, workflow definitions, …) so
  // server-side handlers can resolve `?namespace=test`. The mock OAuth base
  // URL (written by globalSetup) is threaded into the seeded `github-mock`
  // provider so the per-agent OAuth journey connects through the mock.
  await seedPostgresNamespace(testUserId, { mockOAuthBaseUrl: readMockOAuthBaseUrl() });

  // 4. Sign in via test-login page to capture auth state
  // First load warms up Next.js compilation — allow extra time
  await page.goto('/test-login', { timeout: 60_000 });
  await page.fill('input[name="email"]', TEST_EMAIL);
  await page.fill('input[name="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  // Wait for the button to show "Signing in…" then for navigation
  // The sign-in triggers onAuthStateChanged which updates React state
  // and the useEffect in test-login navigates to /redirect
  await page.waitForFunction(
    () => !window.location.pathname.includes('test-login') && !window.location.pathname.includes('login'),
    { timeout: 15_000 },
  );
  // Now wait for the redirect page to resolve to the org handle
  await page.waitForURL(`**/${TEST_ORG_HANDLE}`, { timeout: 30_000 });

  // 5. Save auth state for reuse by authenticated tests
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});
