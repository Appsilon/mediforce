import { test, expect } from '../helpers/test-fixtures';
import { createTestUser } from '../helpers/emulator';
import { trackPageErrors } from '../helpers/page-errors';

const BOOTSTRAP_EMAIL = 'bootstrap-journey@mediforce.dev';
const BOOTSTRAP_PASSWORD = 'Journey123!';

/**
 * Phase 4 PR4 — `GET /api/users/me` lazy bootstrap.
 *
 * A user that exists in Firebase Auth but has no Firestore doc, no namespace,
 * and no member entry signs in for the first time. The headless `/api/users/me`
 * handler must create their personal namespace on the first call (idempotent)
 * and the picker must show it. Pre-PR4 the same bootstrap ran inline in
 * `auth-context.tsx`; this journey asserts the new server-side path keeps the
 * UX identical.
 */
test.describe('Personal namespace lazy bootstrap journey', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async () => {
    // No Firestore seeding — the only state for this user is the Firebase Auth
    // account. The first GET /api/users/me must bootstrap the personal
    // namespace.
    await createTestUser(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD, 'Bootstrap User');
  });

  test('first sign-in bootstraps the personal namespace via /api/users/me', async ({ page }) => {
    test.setTimeout(60_000);
    trackPageErrors(page);

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Mediforce' })).toBeVisible({ timeout: 15_000 });

    await page.getByLabel('Email').click();
    await page.getByLabel('Email').fill(BOOTSTRAP_EMAIL);
    await page.getByLabel('Password').fill(BOOTSTRAP_PASSWORD);

    await page.getByRole('button', { name: /^sign in$/i }).click();

    // Single workspace (the lazy-bootstrapped personal one) → picker auto-
    // redirects to it. The handle is derived from the email local part.
    await page.waitForURL(/\/(bootstrap-journey|workspace-selection)/, { timeout: 25_000 });

    // Sidebar workspace switcher shows the personal entry (label "My profile"
    // in the app shell), proving the GET /api/users/me cache populated.
    await expect(page.getByText(/my profile/i)).toBeVisible({ timeout: 10_000 });
  });
});
