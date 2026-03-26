import { test, expect } from '@playwright/test';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, showStep, showResult } from '../helpers/recording';

test.describe('Workflow Home Journey', () => {
  test('browse workflows, check run data, and navigate to run detail', async ({ page }) => {
    await setupRecording(page);
    await page.goto(`/${TEST_ORG_HANDLE}`);
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible({ timeout: 10_000 });

    // Workflow cards visible
    await expect(page.getByText('Supply Chain Review').first()).toBeVisible();
    await expect(page.getByText('Data Quality Review')).toBeVisible();
    await showStep(page);

    // Run count and active badge
    await expect(page.getByText('6 runs').first()).toBeVisible();
    await expect(page.getByText('4 active')).toBeVisible();

    // Instance row data
    await expect(page.getByText('#proc-r')).toBeVisible();
    await expect(page.getByText('Narrative Summary').first()).toBeVisible();

    // Display popover
    await page.getByRole('button', { name: /display/i }).click();
    await expect(page.getByText('Completed runs')).toBeVisible();
    await showStep(page);
    // Close popover
    await page.locator('body').click({ position: { x: 0, y: 0 } });

    // Navigate to run detail
    const hash = page.getByText('#proc-r').first();
    await hash.click();
    await expect(page).toHaveURL(/\/workflows\/Supply%20Chain%20Review\/runs\/proc-running-1/);
    await showResult(page);
  });
});
