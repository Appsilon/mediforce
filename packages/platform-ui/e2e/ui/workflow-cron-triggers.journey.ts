import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

/**
 * Cron Trigger management UI (ADR-0010). Exercises the "Schedules" tab on a
 * workflow detail page: add a cron trigger to an existing (manual-only)
 * workflow, see it listed as Running, stop it (still listed, Stopped), then
 * delete it. Cron triggers are their own store, so this mutating flow does not
 * touch data any other journey reads.
 */

test.describe('Workflow Cron Triggers Journey', () => {
  test('add, stop, and delete a cron trigger from the Schedules tab', async ({ page }) => {
    trackPageErrors(page);

    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Data%20Quality%20Review`);
    await expect(page.getByRole('tab', { name: /runs/i })).toBeVisible({ timeout: 30_000 });

    // Open the Schedules tab.
    await page.getByRole('tab', { name: 'Schedules' }).click();
    await expect(page.getByText(/no cron triggers yet/i)).toBeVisible({ timeout: 10_000 });

    // Add a cron trigger to this manual-only workflow — no new version needed.
    const triggerName = 'e2e-nightly';
    await page.getByPlaceholder('nightly-refresh').fill(triggerName);
    await page.getByPlaceholder('0 6 * * *').fill('0 3 * * *');
    await page.getByRole('button', { name: 'Add trigger' }).click();

    // It appears in the list, enabled.
    await expect(page.getByText(triggerName)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Running')).toBeVisible();

    // Stop it — still listed, now Stopped.
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByText('Stopped')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(triggerName)).toBeVisible();

    // Delete it (confirm dialog) — it disappears from the list.
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(/no cron triggers yet/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(triggerName)).toHaveCount(0);
  });
});
