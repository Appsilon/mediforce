import { test, expect } from '@playwright/test';
import { TEST_ORG_HANDLE } from '../helpers/constants';

test.describe('Task Review Journey', () => {
  test('browse tasks, interact with grouping, and view task details', async ({ page }) => {
    // Go to tasks page
    await page.goto(`/${TEST_ORG_HANDLE}/tasks`);
    await expect(page.getByRole('heading', { name: 'New actions' })).toBeVisible({ timeout: 10_000 });

    // Flat list shows task and process name
    await expect(page.getByText('Review Intake Data')).toBeVisible();
    await expect(page.getByText('Supply Chain Review').first()).toBeVisible();

    // Open Display popover, check grouping options
    await page.getByRole('button', { name: /display/i }).click();
    await expect(page.getByText('Workflow', { exact: true })).toBeVisible();
    await expect(page.getByText('Action', { exact: true })).toBeVisible();

    // Toggle Action grouping
    await page.getByText('Action', { exact: true }).click();
    await expect(page.getByText('Action needed').first()).toBeVisible();

    // Navigate to task detail via direct URL (grouping UI verified above)
    await page.goto(`/${TEST_ORG_HANDLE}/tasks/task-pending-1`);
    await expect(page.getByRole('heading', { name: 'Review Intake Data' })).toBeVisible({ timeout: 10_000 });
  });

  test('pending task shows verdict form and previous step output', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/tasks/task-human-review`);
    await expect(page.getByText(/Human Review/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/pending/i)).toBeVisible();
    await expect(page.getByText('reviewer')).toBeVisible();

    // Approve button visible directly (no claim step needed)
    await expect(page.getByRole('button', { name: /approve/i })).toBeVisible();

    // Expand previous step output
    await page.getByText(/previous step output/i).click();
    await expect(page.getByRole('tab', { name: /summary/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /full output/i })).toBeVisible();
  });

  test('claimed task shows verdict buttons, completed task shows record', async ({ page }) => {
    // Claimed task
    await page.goto(`/${TEST_ORG_HANDLE}/tasks/task-claimed-1`);
    await expect(page.getByRole('button', { name: /approve/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /revise/i })).toBeVisible();

    // Navigate to completed task
    await page.goto(`/${TEST_ORG_HANDLE}/tasks/task-completed-1`);
    await expect(page.getByText(/completed/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
