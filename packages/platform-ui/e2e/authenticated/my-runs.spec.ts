import { test, expect } from '@playwright/test';

// Uses seeded data from auth-setup.ts:
// - processInstances:
//   proc-running-1 (Supply Chain Review, running)
//   proc-paused-1 (Supply Chain Review, paused)
//   proc-completed-1 (Data Quality Review, completed)
//   proc-failed-1 (Supply Chain Review, failed)
//   proc-completed-2 (Supply Chain Review, completed)
//   proc-human-waiting (Supply Chain Review, paused)
//   proc-upload-waiting (Protocol to TFL, paused)

test.describe('My Runs', () => {
  test('[RENDER] page loads and shows heading', async ({ page }) => {
    await page.goto('/runs');
    await expect(page.getByRole('heading', { name: 'My Runs' })).toBeVisible();
  });

  test('[RENDER] shows process cards grouped by definition', async ({ page }) => {
    await page.goto('/runs');
    // Supply Chain Review appears as a single card (not 5 separate sections)
    await expect(page.getByText('Supply Chain Review').first()).toBeVisible({ timeout: 10_000 });
    // Data Quality Review as another card
    await expect(page.getByText('Data Quality Review')).toBeVisible();
  });

  test('[DATA] Supply Chain Review card shows run count', async ({ page }) => {
    await page.goto('/runs');
    await expect(page.getByText('5 runs')).toBeVisible({ timeout: 10_000 });
  });

  test('[DATA] Supply Chain Review card shows active count badge', async ({ page }) => {
    await page.goto('/runs');
    // proc-running-1 (running), proc-paused-1 (paused), proc-human-waiting (paused) = 3 active
    await expect(page.getByText('3 active')).toBeVisible({ timeout: 10_000 });
  });

  test('[RENDER] instance rows show short hash identifiers', async ({ page }) => {
    await page.goto('/runs');
    // proc-running-1 → #proc-r (first 6 chars)
    await expect(page.getByText('#proc-r')).toBeVisible({ timeout: 10_000 });
  });

  test('[RENDER] instance rows show current step in human-readable format', async ({ page }) => {
    await page.goto('/runs');
    // proc-running-1 has currentStepId: 'narrative-summary' → "Narrative Summary"
    await expect(page.getByText('Narrative Summary')).toBeVisible({ timeout: 10_000 });
  });

  test('[CLICK] clicking instance row navigates to detail', async ({ page }) => {
    await page.goto('/runs');
    await page.getByText('#proc-r').first().click({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/processes\/Supply%20Chain%20Review\/runs\/proc-running-1/);
  });

  test('[RENDER] completed instances are collapsed by default', async ({ page }) => {
    await page.goto('/runs');
    // Supply Chain Review has 2 completed + 1 failed = collapsed section
    await expect(page.getByText('2 completed').first()).toBeVisible({ timeout: 10_000 });
  });

  test('[RENDER] Display popover shows grouping option', async ({ page }) => {
    await page.goto('/runs');
    await page.getByText('Supply Chain Review').first().waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: /display/i }).click();
    await expect(page.getByText('Process')).toBeVisible();
  });
});
