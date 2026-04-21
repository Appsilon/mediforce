import { test, expect } from '@playwright/test';
import { TEST_ORG_HANDLE } from './helpers/constants';

test.describe('Smoke Tests', () => {
  test('login page loads and shows sign-in button', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/mediforce/i);
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
  });

  test('unauthenticated user is redirected to login', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/tasks`);
    await page.waitForURL('**/login**');
    await expect(page).toHaveURL(/\/login/);
  });
});
