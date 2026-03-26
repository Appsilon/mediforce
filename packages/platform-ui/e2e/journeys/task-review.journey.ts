import { test, expect } from '@playwright/test';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, showStep, showResult } from '../helpers/recording';

test.describe('Task Review Journey', () => {
  test('browse tasks, interact with grouping, and view task details', async ({ page }) => {
    await setupRecording(page);
    await page.goto(`/${TEST_ORG_HANDLE}/tasks`);
    await expect(page.getByRole('heading', { name: 'New actions' })).toBeVisible({ timeout: 10_000 });

    // Flat list shows task and process name
    await expect(page.getByText('Review Intake Data')).toBeVisible();
    await expect(page.getByText('Supply Chain Review').first()).toBeVisible();
    await showStep(page);

    // Open Display popover, check grouping options
    await page.getByRole('button', { name: /display/i }).click();
    await expect(page.getByText('Workflow', { exact: true })).toBeVisible();
    await expect(page.getByText('Action', { exact: true })).toBeVisible();
    await showStep(page);

    // Toggle Action grouping
    await page.getByText('Action', { exact: true }).click();
    await expect(page.getByText('Action needed').first()).toBeVisible();
    await showResult(page);

    // Navigate to task detail
    await page.goto(`/${TEST_ORG_HANDLE}/tasks/task-pending-1`);
    await expect(page.getByRole('heading', { name: 'Review Intake Data' })).toBeVisible({ timeout: 10_000 });
    await showResult(page);
  });

  test('pending task shows verdict form and previous step output', async ({ page }) => {
    await setupRecording(page);
    await page.goto(`/${TEST_ORG_HANDLE}/tasks/task-human-review`);
    await expect(page.getByText(/Human Review/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/pending/i)).toBeVisible();
    await expect(page.getByText('reviewer')).toBeVisible();
    await showStep(page);

    // Approve button visible directly
    await expect(page.getByRole('button', { name: /approve/i })).toBeVisible();
    await showStep(page);

    // Expand previous step output
    await page.getByText(/previous step output/i).click();
    await expect(page.getByRole('tab', { name: /summary/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /full output/i })).toBeVisible();
    await showResult(page);
  });

  test('claimed task shows verdict buttons, completed task shows record', async ({ page }) => {
    await setupRecording(page);
    await page.goto(`/${TEST_ORG_HANDLE}/tasks/task-claimed-1`);
    await expect(page.getByRole('button', { name: /approve/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /revise/i })).toBeVisible();
    await showResult(page);

    await page.goto(`/${TEST_ORG_HANDLE}/tasks/task-completed-1`);
    await expect(page.getByText(/completed/i).first()).toBeVisible({ timeout: 10_000 });
    await showResult(page);
  });
});
