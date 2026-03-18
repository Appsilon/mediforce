import { test, expect } from '@playwright/test';

test.describe('Workflow Definitions', () => {
  test('[RENDER] workflow detail page has Runs and Definitions tabs', async ({ page }) => {
    await page.goto('/workflows/Supply%20Chain%20Review');
    await expect(page.getByRole('tab', { name: /runs/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: /definitions/i })).toBeVisible();
  });

  test('[CLICK] Definitions tab is clickable and shows content', async ({ page }) => {
    await page.goto('/workflows/Supply%20Chain%20Review');
    await page.getByRole('tab', { name: /definitions/i }).click();
    // Should show either definitions list or empty state
    await expect(
      page.locator('text=/No definitions|version|Create first/i').first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('[RENDER] Runs tab is the default tab', async ({ page }) => {
    await page.goto('/workflows/Supply%20Chain%20Review');
    // Runs tab should be active by default
    const runsTab = page.getByRole('tab', { name: /runs/i });
    await expect(runsTab).toBeVisible({ timeout: 10_000 });
    await expect(runsTab).toHaveAttribute('data-state', 'active');
  });

  test('[RENDER] Configurations tab no longer exists', async ({ page }) => {
    await page.goto('/workflows/Supply%20Chain%20Review');
    await expect(page.getByRole('tab', { name: /configurations/i })).not.toBeVisible();
  });
});
