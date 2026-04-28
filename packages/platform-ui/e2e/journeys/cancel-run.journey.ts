import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Cancel Run Journey', () => {
  test('dismiss cancel, then confirm cancel — run status changes', async ({ page }, testInfo) => {
    await setupRecording(page, 'cancel-run', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-cancel-target`);
    await expect(page.getByRole('button', { name: /^cancel$/i })).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Click cancel — confirmation appears
    await click(page, page.getByRole('button', { name: /^cancel$/i }));
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /confirm cancel/i })).toBeVisible();
    await showStep(page);

    // Dismiss with "Keep running" — back to idle
    await click(page, page.getByRole('button', { name: /keep running/i }));
    await expect(page.getByRole('button', { name: /^cancel$/i })).toBeVisible();
    await showStep(page);

    // Now actually cancel — click cancel again and confirm
    await click(page, page.getByRole('button', { name: /^cancel$/i }));
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();
    await click(page, page.getByRole('button', { name: /confirm cancel/i }));

    // Run shows "Error" badge after cancellation (cancelled runs map to the error display status)
    await expect(page.getByText(/^error$/i).first()).toBeVisible({ timeout: 10_000 });
    await showResult(page);
    await endRecording(page);
  });
});
