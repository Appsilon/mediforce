import { test, expect } from '@playwright/test';

test.describe('Smoke Tests', () => {
  test('login page loads and shows Supply Intelligence branding', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Supply Intelligence')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  });

  test('unauthenticated user is redirected to login', async ({ page }) => {
    await page.goto('/overview');
    await page.waitForURL('**/login**');
    await expect(page).toHaveURL(/\/login/);
  });
});
