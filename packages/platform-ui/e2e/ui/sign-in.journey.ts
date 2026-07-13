import { test, expect } from '../helpers/test-fixtures';
import { createTestUser } from '../helpers/emulator';
import { seedPostgresPersonalNamespace } from '../helpers/postgres-seed';
import { trackPageErrors } from '../helpers/page-errors';

const SIGN_IN_EMAIL = 'signin-journey@mediforce.dev';
const SIGN_IN_PASSWORD = 'Journey123!';

test.describe('Sign-in Journey', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async () => {
    const uid = await createTestUser(SIGN_IN_EMAIL, SIGN_IN_PASSWORD, 'Journey User');
    // The user's single personal workspace. handle + displayName live on the
    // `workspaces` row now (the legacy `users/{uid}` doc fields are not carried
    // over — identity comes from Firebase Auth, membership from
    // `workspace_members`). Post-sign-in resolves to this one handle.
    await seedPostgresPersonalNamespace('journey-user', uid, 'Journey User');
  });

  test('user signs in with email and password', async ({ page }) => {
    trackPageErrors(page);

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Mediforce' })).toBeVisible({ timeout: 10_000 });

    await page.getByLabel('Email').click();
    await page.getByLabel('Email').fill(SIGN_IN_EMAIL);
    await page.getByLabel('Password').fill(SIGN_IN_PASSWORD);

    await page.getByRole('button', { name: /^sign in$/i }).click();

    // Single workspace → workspace-selection auto-redirects to personal handle
    await page.waitForURL(/\/(journey-user|workspace-selection)/, { timeout: 20_000 });
  });
});
