import { test, expect } from '@playwright/test';
import { TEST_ORG_HANDLE } from '../helpers/constants';

test.describe('Authenticated Navigation', () => {
  test('authenticated user can access tasks page', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/tasks`);
    await expect(page).toHaveURL(/\/tasks/);
    await expect(page.getByRole('heading', { name: 'New actions' })).toBeVisible();
  });

  test('sidebar navigation links are visible', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/tasks`);
    await expect(page.getByRole('link', { name: /new actions/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /workflows/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /agents/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /monitoring/i })).toBeVisible();
  });
});
