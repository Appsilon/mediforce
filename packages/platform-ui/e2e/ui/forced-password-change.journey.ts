import { test, expect } from '../helpers/test-fixtures';
import { createTestUser, deleteAuthUser, seedCollection } from '../helpers/emulator';
import { setupRecording, allowPageErrors, click, showStep, showResult, showCaption, endRecording } from '../helpers/recording';

const INVITED_EMAIL = 'invited-user@mediforce.dev';
const INVITED_TEMP_PASSWORD = 'TempPass123!';
const NEW_PASSWORD = 'NewSecurePass456!';

test.describe('Forced Password Change Journey', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async () => {
    // On a retry the test has already changed this user's password, so a plain
    // re-create would sign in with the stale temp password and throw
    // INVALID_PASSWORD. Drop just this account first (scoped — never wipes the
    // shared auth-setup state) so the user is always recreated with the temp
    // password the test signs in with.
    await deleteAuthUser(INVITED_EMAIL);
    const uid = await createTestUser(INVITED_EMAIL, INVITED_TEMP_PASSWORD, 'Invited User');

    await seedCollection('users', {
      [uid]: {
        uid,
        email: INVITED_EMAIL,
        displayName: 'Invited User',
        mustChangePassword: true,
        handle: 'invited-personal',
      },
    });
    await seedCollection('namespaces', {
      'invited-personal': {
        handle: 'invited-personal',
        type: 'personal',
        displayName: 'Invited User',
        linkedUserId: uid,
        createdAt: new Date().toISOString(),
      },
    });
  });

  test('invited user is forced to set a permanent password on first sign-in', async ({ page }, testInfo) => {
    await setupRecording(page, 'forced-password-change', testInfo);

    // Changing the password revokes the user's existing ID token (Firebase
    // moves `validSince` to now). The client re-authenticates immediately, but
    // for a sub-second window background providers on the landing page (docker
    // images, namespace) can fire with a token whose whole-second `auth_time`
    // has not yet overtaken `validSince`. The Auth emulator's admin SDK rejects
    // those as revoked — production `verifyIdToken` does not check revocation,
    // so this transient 401 cannot happen there. Tolerate it here.
    allowPageErrors(page, ['the server responded with a status of 401']);

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Mediforce' })).toBeVisible({ timeout: 10_000 });
    await showCaption(page, 'Invited user signs in with temporary password');

    await click(page, page.getByLabel('Email'));
    await page.getByLabel('Email').fill(INVITED_EMAIL);
    await page.getByLabel('Password').fill(INVITED_TEMP_PASSWORD);
    await showStep(page);

    await click(page, page.getByRole('button', { name: /^sign in$/i }));

    // After sign-in the (app) layout detects mustChangePassword and redirects to /change-password
    await page.waitForURL('**/change-password', { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible({ timeout: 10_000 });
    await showCaption(page, 'Redirected to mandatory password change');
    await showStep(page);

    await click(page, page.getByLabel('New password'));
    await page.getByLabel('New password').fill(NEW_PASSWORD);
    await page.getByLabel('Confirm password').fill(NEW_PASSWORD);
    await showStep(page);

    await showCaption(page, 'Setting permanent password…');
    await click(page, page.getByRole('button', { name: /set password and continue/i }));

    // After clearing mustChangePassword the page redirects to workspace-selection,
    // which then redirects to the user's single personal workspace
    await page.waitForURL(/\/(invited-personal|workspace-selection)/, { timeout: 20_000 });
    await showResult(page);
    await showCaption(page, 'Password set — account fully activated');
    await endRecording(page);
  });
});
