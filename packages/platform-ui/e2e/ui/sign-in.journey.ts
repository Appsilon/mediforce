import { test, expect } from '../helpers/test-fixtures';
import { createTestUser, seedCollection } from '../helpers/emulator';
import { setupRecording, click, showStep, showResult, showCaption, endRecording } from '../helpers/recording';

const SIGN_IN_EMAIL = 'signin-journey@mediforce.dev';
const SIGN_IN_PASSWORD = 'Journey123!';

test.describe('Sign-in Journey', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async () => {
    const uid = await createTestUser(SIGN_IN_EMAIL, SIGN_IN_PASSWORD, 'Journey User');
    await seedCollection('users', {
      [uid]: { uid, email: SIGN_IN_EMAIL, displayName: 'Journey User', handle: 'journey-user' },
    });
    await seedCollection('namespaces', {
      'journey-user': {
        handle: 'journey-user',
        type: 'personal',
        displayName: 'Journey User',
        linkedUserId: uid,
        createdAt: new Date().toISOString(),
      },
    });
  });

  test('user signs in with email and password', async ({ page }, testInfo) => {
    await setupRecording(page, 'sign-in', testInfo);

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Mediforce' })).toBeVisible({ timeout: 10_000 });
    await showCaption(page, 'Sign in with email and password');

    await click(page, page.getByLabel('Email'));
    await page.getByLabel('Email').fill(SIGN_IN_EMAIL);
    await page.getByLabel('Password').fill(SIGN_IN_PASSWORD);
    await showStep(page);

    await showCaption(page, 'Submitting credentials…');
    await click(page, page.getByRole('button', { name: /^sign in$/i }));

    // Single workspace → workspace-selection auto-redirects to personal handle
    await page.waitForURL(/\/(journey-user|workspace-selection)/, { timeout: 20_000 });
    await showResult(page);
    await showCaption(page, 'Signed in successfully');
    await endRecording(page);
  });
});
