import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

/**
 * Trigger management UI (ADR-0011). Exercises the "Triggers" tab on a workflow
 * detail page: add a cron trigger to an existing (manual-only) workflow, see it
 * listed as Running, stop it (still listed, Stopped), then delete it. Triggers
 * live in their own table, so this mutating flow does not touch data any other
 * journey reads.
 */

test.describe('Workflow Triggers Journey', () => {
  test('add, stop, and delete a cron trigger from the Triggers tab', async ({ page }) => {
    trackPageErrors(page);

    const triggerName = 'e2e-nightly';

    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Data%20Quality%20Review`);
    await expect(page.getByRole('tab', { name: /runs/i })).toBeVisible({ timeout: 30_000 });

    // Open the Triggers tab.
    await page.getByRole('tab', { name: 'Triggers' }).click();

    // Reset: a prior attempt may have left this row behind (Playwright retries
    // reuse the shared seed data). Delete it before asserting the clean state so
    // a retry exposes the original failure, not a stale-row setup failure.
    await expect(
      page.getByText(triggerName).or(page.getByText(/no triggers yet/i)),
    ).toBeVisible({ timeout: 10_000 });
    if (await page.getByText(triggerName).isVisible()) {
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Delete' }).click();
    }
    await expect(page.getByText(/no triggers yet/i)).toBeVisible({ timeout: 10_000 });

    // Add a cron trigger to this manual-only workflow — no new version needed.
    await page.getByPlaceholder('nightly-refresh').fill(triggerName);
    await page.getByPlaceholder('0 6 * * *').fill('0 3 * * *');
    await page.getByRole('button', { name: 'Add trigger' }).click();

    // It appears in the list, enabled.
    await expect(page.getByText(triggerName)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Running')).toBeVisible();

    // The page header reflects the live schedule as running.
    await expect(page.getByText(/runs automatically/i)).toBeVisible({ timeout: 15_000 });

    // Stop it — still listed, now Stopped.
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByText('Stopped')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(triggerName)).toBeVisible();

    // The header must drop "Runs automatically" once the schedule is stopped.
    await expect(page.getByText(/runs automatically/i)).toHaveCount(0);
    await expect(page.getByText(/schedule stopped/i)).toBeVisible();

    // Delete it (confirm dialog) — it disappears from the list.
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(/no triggers yet/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(triggerName)).toHaveCount(0);
  });
});
