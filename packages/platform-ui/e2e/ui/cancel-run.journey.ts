import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

test.describe('Cancel Run Journey', () => {
  test('dismiss cancel, then confirm cancel — run status changes', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-cancel-target`);
    await expect(page.getByRole('button', { name: /^cancel run$/i })).toBeVisible({ timeout: 10_000 });

    // Click cancel — confirmation appears
    await page.getByRole('button', { name: /^cancel run$/i }).click();
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /confirm cancel/i })).toBeVisible();

    // Dismiss with "Keep running" — back to idle
    await page.getByRole('button', { name: /keep running/i }).click();
    await expect(page.getByRole('button', { name: /^cancel run$/i })).toBeVisible();

    // Now actually cancel — click cancel again and confirm
    await page.getByRole('button', { name: /^cancel run$/i }).click();
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();
    await page.getByRole('button', { name: /confirm cancel/i }).click();

    // Run shows "Cancelled" badge after cancellation (distinct gray badge, not Error)
    await expect(page.getByText(/^cancelled$/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
