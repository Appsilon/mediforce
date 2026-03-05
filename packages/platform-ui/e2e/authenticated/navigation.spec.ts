import { test, expect } from '@playwright/test';

test.describe('Authenticated Navigation', () => {
  test('authenticated user can access tasks page', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page).toHaveURL(/\/tasks/);
    await expect(page.getByRole('heading', { name: 'My Tasks' })).toBeVisible();
  });

  test('sidebar navigation links are visible', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByRole('link', { name: /my tasks/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /processes/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /agent catalog/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /agent oversight/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /monitoring/i })).toBeVisible();
  });
});
