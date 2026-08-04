import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

test.describe('Entry Step Trigger Input Journey', () => {
  test('shows the run trigger payload as the entry step input', async ({ page }) => {
    trackPageErrors(page);

    await page.goto(
      `/${TEST_ORG_HANDLE}/workflows/Entry%20Trigger%20Input/runs/proc-entry-trigger-input/steps/process?executionId=exec-entry-trigger-input`,
    );

    await expect(page.getByRole('heading', { name: 'Input' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Study Id', { exact: true })).toBeVisible();
    await expect(page.getByText('STUDY-ENTRY-001', { exact: true })).toBeVisible();
    await expect(page.getByText('Priority', { exact: true })).toBeVisible();
    await expect(page.getByText('high', { exact: true })).toBeVisible();
    await expect(page.getByText('Dry Run', { exact: true })).toBeVisible();
    const inputColumn = page.getByRole('heading', { name: 'Input' }).locator('..');
    await expect(inputColumn.getByText('true', { exact: true })).toBeVisible();
    await expect(page.getByText('Entry point — no input data')).not.toBeVisible();
  });
});
