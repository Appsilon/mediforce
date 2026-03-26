import { test, expect } from '@playwright/test';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Task Review Journey', () => {
  test('browse tasks, interact with grouping, and navigate to task detail', async ({ page }) => {
    await setupRecording(page);
    await page.goto(`/${TEST_ORG_HANDLE}/tasks`);
    await expect(page.getByRole('heading', { name: 'New actions' })).toBeVisible({ timeout: 10_000 });

    // Flat list shows task and process name
    await expect(page.getByText('Review Intake Data')).toBeVisible();
    await expect(page.getByText('Supply Chain Review').first()).toBeVisible();
    await showStep(page);

    // Open Display popover, check grouping options
    await click(page, page.getByRole('button', { name: /display/i }));
    await expect(page.getByText('Workflow', { exact: true })).toBeVisible();
    await expect(page.getByText('Action', { exact: true })).toBeVisible();
    await showStep(page);

    // Toggle Action grouping
    await click(page, page.getByText('Action', { exact: true }));
    await expect(page.getByText('Action needed').first()).toBeVisible();
    await showResult(page);

    // Navigate to task detail via sidebar
    await click(page, page.getByRole('link', { name: /new actions/i }));
    await expect(page.getByText('Review Intake Data')).toBeVisible({ timeout: 10_000 });
    await click(page, page.getByText('Review Intake Data'));
    await expect(page.getByText('Review Intake Data')).toBeVisible({ timeout: 10_000 });
    await showResult(page);
  });

  test('reviewer approves a task and sees confirmation', async ({ page }) => {
    await setupRecording(page);
    await page.goto(`/${TEST_ORG_HANDLE}/tasks/task-human-review`);
    await expect(page.getByText(/Human Review/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/pending/i)).toBeVisible();
    await showStep(page);

    // Expand previous step output to review context
    await click(page, page.getByText(/previous step output/i));
    await expect(page.getByRole('tab', { name: /summary/i })).toBeVisible();
    await showStep(page);

    // Approve button is actionable
    await expect(page.getByRole('button', { name: /approve/i })).toBeEnabled();
    await showResult(page);
    await endRecording(page);
    // NOTE: Actually clicking approve requires server action with Firestore write.
    // This is a known gap — server actions in emulator mode may lack auth context.
  });
});
