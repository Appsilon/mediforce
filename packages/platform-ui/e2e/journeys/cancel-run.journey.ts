import { test, expect } from '@playwright/test';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Cancel Run Journey', () => {
  test('cancel flow: confirm appears, dismiss works, cancel button returns', async ({ page }) => {
    await setupRecording(page);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);
    await expect(page.getByRole('button', { name: /^cancel$/i })).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Click cancel
    await click(page, page.getByRole('button', { name: /^cancel$/i }));
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /confirm cancel/i })).toBeVisible();
    await showStep(page);

    // Dismiss with "Keep running"
    await click(page, page.getByRole('button', { name: /keep running/i }));
    await expect(page.getByRole('button', { name: /^cancel$/i })).toBeVisible();
    await showResult(page);
    await endRecording(page);
  });
});
