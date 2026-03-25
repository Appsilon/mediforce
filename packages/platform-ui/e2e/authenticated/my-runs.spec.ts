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
    await page.goto('/workflows');
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();
  });

  test('[RENDER] shows process cards grouped by definition', async ({ page }) => {
    await page.goto('/workflows');
    // Supply Chain Review appears as a single card (not 5 separate sections)
    await expect(page.getByText('Supply Chain Review').first()).toBeVisible({ timeout: 10_000 });
    // Data Quality Review as another card
    await expect(page.getByText('Data Quality Review')).toBeVisible();
  });

  test('[DATA] Supply Chain Review card shows run count', async ({ page }) => {
    await page.goto('/workflows');
    await expect(page.getByText('6 runs').first()).toBeVisible({ timeout: 10_000 });
  });

  test('[DATA] Supply Chain Review card shows active count badge', async ({ page }) => {
    await page.goto('/workflows');
    // proc-running-1, proc-workflow-run-1 (running), proc-paused-1, proc-human-waiting (paused) = 4 active
    await expect(page.getByText('4 active')).toBeVisible({ timeout: 10_000 });
  });

  test('[RENDER] instance rows show short hash identifiers', async ({ page }) => {
    await page.goto('/workflows');
    // proc-running-1 → #proc-r (first 6 chars)
    await expect(page.getByText('#proc-r')).toBeVisible({ timeout: 10_000 });
  });

  test('[RENDER] instance rows show current step in human-readable format', async ({ page }) => {
    await page.goto('/workflows');
    // proc-running-1 has currentStepId: 'narrative-summary' → "Narrative Summary"
    // proc-workflow-run-1 also has currentStepId: 'narrative-summary'
    await expect(page.getByText('Narrative Summary').first()).toBeVisible({ timeout: 10_000 });
  });

  test('[CLICK] clicking instance hash navigates to run detail', async ({ page }) => {
    await page.goto('/workflows');
    const hash = page.getByText('#proc-r').first();
    await hash.waitFor({ state: 'visible', timeout: 10_000 });
    await hash.click();
    await expect(page).toHaveURL(/\/workflows\/Supply%20Chain%20Review\/runs\/proc-running-1/);
  });

  test('[RENDER] Display popover shows grouping and filter options', async ({ page }) => {
    await page.goto('/workflows');
    await page.getByText('Supply Chain Review').first().waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: /display/i }).click();
    await expect(page.getByText('Completed runs')).toBeVisible();
  });
});
