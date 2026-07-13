import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

test.describe('Task Review Journey', () => {
  test('browse tasks, interact with grouping, and navigate to task detail', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/tasks`);
    await expect(page.getByRole('heading', { name: 'Human actions' })).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText('Review Intake Data')).toBeVisible();
    await expect(page.getByText('Supply Chain Review').first()).toBeVisible();

    await page.getByRole('button', { name: /display/i }).click();
    // The Display popover has "Workflow" and "Action" as group-by buttons.
    // Use getByRole('button') to distinguish from the "Workflow" table column header.
    await expect(page.getByRole('button', { name: 'Workflow', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Action', exact: true })).toBeVisible();

    await page.getByText('Action', { exact: true }).click();
    await expect(page.getByText('Action needed').first()).toBeVisible();

    await page.getByRole('link', { name: /human actions/i }).click();
    const taskLink = page.getByText('Review Intake Data').first();
    await expect(taskLink).toBeVisible({ timeout: 10_000 });
    await taskLink.click();
    await expect(page.getByRole('heading', { name: 'Review Intake Data' })).toBeVisible({ timeout: 20_000 });
  });

  test('reviewer approves a task and sees confirmation', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/tasks/task-review-target`);
    await expect(page.getByText(/Human Review/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/pending/i)).toBeVisible();

    // Previous Step Output panel is open by default; both Report and Extracted
    // Data tabs are visible. Assert the always-present Extracted Data tab.
    await expect(page.getByRole('tab', { name: /extracted data/i })).toBeVisible();

    // Lock the single-click invariant before clicking: no Submit button
    // exists in the form. If a future regression reinstated a two-step
    // flow, this assertion would fail before the click below.
    await expect(page.getByRole('button', { name: /submit review/i })).toHaveCount(0);

    // Single-click verdict flow (GitHub-style): the Approve button submits
    // immediately, no secondary Submit step.
    await page.getByRole('button', { name: /^Approve$/ }).click();
    await expect(page.getByRole('link', { name: /view next task/i })).toBeVisible({ timeout: 15_000 });
    // Lock: confirmation appeared without a second click anywhere.
    await expect(page.getByRole('button', { name: /submit review/i })).toHaveCount(0);

    // Status badge updates via onSnapshot listener — no need to navigate back
    await expect(page.getByText(/completed/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
