import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showCaption, endRecording } from '../helpers/recording';

test.describe('Task Review Journey', () => {
  test('browse tasks, interact with grouping, and navigate to task detail', async ({ page }, testInfo) => {
    await setupRecording(page, 'task-browse-and-grouping', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/tasks`);
    await expect(page.getByRole('heading', { name: 'New actions' })).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText('Review Intake Data')).toBeVisible();
    await expect(page.getByText('Supply Chain Review').first()).toBeVisible();
    await showCaption(page, 'Task inbox — flat list with pending actions');

    await click(page, page.getByRole('button', { name: /display/i }));
    await expect(page.getByText('Workflow', { exact: true })).toBeVisible();
    await expect(page.getByText('Action', { exact: true })).toBeVisible();
    await showCaption(page, 'Display options — group by workflow or action type');

    await click(page, page.getByText('Action', { exact: true }));
    await expect(page.getByText('Action needed').first()).toBeVisible();
    await showCaption(page, 'Grouped by action type', 3500);

    await click(page, page.getByRole('link', { name: /new actions/i }));
    const taskLink = page.getByText('Review Intake Data').first();
    await expect(taskLink).toBeVisible({ timeout: 10_000 });
    await click(page, taskLink);
    await expect(page.getByRole('heading', { name: 'Review Intake Data' })).toBeVisible({ timeout: 20_000 });
    await showCaption(page, 'Task detail — full context for review', 3500);
  });

  test('reviewer approves a task and sees confirmation', async ({ page }, testInfo) => {
    await setupRecording(page, 'task-approve-flow', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/tasks/task-review-target`);
    await expect(page.getByText(/Human Review/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/pending/i)).toBeVisible();
    await showCaption(page, 'Human review task — status: pending');

    await click(page, page.getByText(/previous step output/i));
    await expect(page.getByRole('tab', { name: /summary/i })).toBeVisible();
    await showCaption(page, 'Reviewing previous step output');

    await click(page, page.getByRole('button', { name: /approve/i }));
    await expect(page.getByRole('button', { name: /submit review/i })).toBeVisible({ timeout: 5_000 });
    await showCaption(page, 'Two-step approval: Approve → Submit review');

    await click(page, page.getByRole('button', { name: /submit review/i }));
    await expect(page.getByRole('link', { name: /view next task/i })).toBeVisible({ timeout: 15_000 });
    await showCaption(page, 'Task approved — next task available', 3500);

    // Status badge updates via onSnapshot listener — no need to navigate back
    await expect(page.getByText(/completed/i).first()).toBeVisible({ timeout: 10_000 });
    await showCaption(page, 'Status changed to completed', 3500);
    await endRecording(page);
  });
});
