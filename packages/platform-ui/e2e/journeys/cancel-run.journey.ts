import { test, expect } from '@playwright/test';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, showStep, showResult } from '../helpers/recording';

test.describe('Cancel Run Journey', () => {
  test('cancel flow: confirm appears, dismiss works, cancel button returns', async ({ page }) => {
    await setupRecording(page);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);
    await expect(page.getByRole('button', { name: /^cancel$/i })).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Click cancel
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /confirm cancel/i })).toBeVisible();
    await showStep(page);

    // Dismiss with "Keep running"
    await page.getByRole('button', { name: /keep running/i }).click();
    await expect(page.getByRole('button', { name: /^cancel$/i })).toBeVisible();
    await showResult(page);
  });
});
