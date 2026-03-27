import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Workflow Home Journey', () => {
  test('browse workflows, check run data, and navigate to run detail', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-home', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}`);
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible({ timeout: 10_000 });

    // Workflow cards visible
    await expect(page.getByText('Supply Chain Review').first()).toBeVisible();
    await expect(page.getByText('Data Quality Review')).toBeVisible();
    await showStep(page);

    // Run counts visible (exact numbers may vary if other tests mutated state)
    await expect(page.getByText(/\d+ runs/).first()).toBeVisible();
    await expect(page.getByText(/\d+ active/).first()).toBeVisible();

    // Instance row data
    await expect(page.getByText('#proc-r')).toBeVisible();
    await expect(page.getByText('Narrative Summary').first()).toBeVisible();

    // Display popover
    await click(page, page.getByRole('button', { name: /display/i }));
    await expect(page.getByText('Completed runs')).toBeVisible();
    await showStep(page);
    // Close popover
    await page.locator('body').click({ position: { x: 0, y: 0 } });

    // Navigate to run detail
    const hash = page.getByText('#proc-r').first();
    await click(page, hash);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });
    await showResult(page);
    await endRecording(page);
  });
});
