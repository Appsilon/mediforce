import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

test.describe('Workflow Home Journey', () => {
  test('browse workflows, check run data, and navigate to run detail', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}`);
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible({ timeout: 10_000 });

    // Workflow cards visible
    await expect(page.getByText('Supply Chain Review').first()).toBeVisible();
    await expect(page.getByText('Data Quality Review')).toBeVisible();

    // Run counts visible (exact numbers may vary if other tests mutated state)
    await expect(page.getByText(/\d+ runs/).first()).toBeVisible();
    await expect(page.getByText(/\d+ active/).first()).toBeVisible();

    // Instance row data — at least one active run preview visible (run hash display was
    // removed in favour of step-status rows; check for the running step label instead)
    await expect(page.getByText('In Progress').first()).toBeVisible();

    // Display popover
    await page.getByRole('button', { name: /display/i }).click();
    await expect(page.getByText('Completed runs')).toBeVisible();
    // Close popover
    await page.locator('body').click({ position: { x: 0, y: 0 } });

    // Navigate to run detail by clicking the first active run row
    // (all running seed instances are Supply Chain Review, so any row works)
    await page.getByText('In Progress').first().click();
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 30_000 });
  });
});
