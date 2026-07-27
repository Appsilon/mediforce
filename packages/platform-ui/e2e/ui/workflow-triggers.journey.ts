import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

/**
 * Trigger management UI (ADR-0011). Exercises the "Triggers" tab on a workflow
 * detail page. The workflow declares a manual trigger, so the Manual section
 * shows a Running row (seeded on register, Issue #930) and the Start Run button
 * is enabled. The cron flow adds a cron trigger, sees it Running, stops it, then
 * deletes it. Triggers live in their own table, so this mutating flow only
 * touches the cron row it creates — the shared manual trigger is left untouched.
 */

test.describe('Workflow Triggers Journey', () => {
  test('manual section is present; add, stop, and delete a cron trigger', async ({ page }) => {
    trackPageErrors(page);

    const triggerName = 'e2e-nightly';

    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Data%20Quality%20Review`);
    await expect(page.getByRole('tab', { name: /runs/i })).toBeVisible({ timeout: 30_000 });

    // The workflow is hand-startable: the Start Run button reads the manual
    // trigger row (same source of truth as the server guard) and is enabled.
    const startRunButton = page.getByRole('button', { name: /start run/i });
    await expect(startRunButton).toBeEnabled({ timeout: 15_000 });

    // Open the Triggers tab.
    await page.getByRole('tab', { name: 'Triggers' }).click();

    // The Manual section shows the seeded, enabled manual trigger.
    await expect(page.getByRole('heading', { name: 'Manual' })).toBeVisible({ timeout: 10_000 });

    // Scope every cron operation to the cron row / cron form so the manual row's
    // identical Stop/Delete/Running controls never satisfy a selector.
    const cronRow = page.locator('li', { hasText: triggerName });

    // Reset: a prior attempt may have left this row behind (Playwright retries
    // reuse the shared seed data). Delete it before asserting the clean state.
    if ((await cronRow.count()) > 0) {
      page.once('dialog', (dialog) => dialog.accept());
      await cronRow.getByRole('button', { name: 'Delete' }).click();
    }
    await expect(page.getByText(/no cron triggers yet/i)).toBeVisible({ timeout: 10_000 });

    // Add a cron trigger to this workflow — no new version needed.
    await page.getByPlaceholder('nightly-refresh').fill(triggerName);
    await page.getByPlaceholder('0 6 * * *').fill('0 3 * * *');
    await page.getByRole('button', { name: 'Add cron trigger' }).click();

    // It appears in the list, enabled.
    await expect(cronRow).toBeVisible({ timeout: 15_000 });
    await expect(cronRow.getByText('Running')).toBeVisible();

    // The page header reflects the live schedule as running.
    await expect(page.getByText(/runs automatically/i)).toBeVisible({ timeout: 15_000 });

    // Stop it — still listed, now Stopped.
    await cronRow.getByRole('button', { name: 'Stop' }).click();
    await expect(cronRow.getByText('Stopped', { exact: true })).toBeVisible({ timeout: 15_000 });

    // The header must drop "Runs automatically" once the schedule is stopped.
    await expect(page.getByText(/runs automatically/i)).toHaveCount(0);
    await expect(page.getByText(/schedule stopped/i)).toBeVisible();

    // Delete it (confirm dialog) — it disappears from the list.
    page.once('dialog', (dialog) => dialog.accept());
    await cronRow.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(/no cron triggers yet/i)).toBeVisible({ timeout: 15_000 });
    await expect(cronRow).toHaveCount(0);
  });
});
