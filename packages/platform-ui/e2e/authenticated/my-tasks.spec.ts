import { test, expect } from '@playwright/test';

// Uses seeded data from auth-setup.ts:
// - humanTasks: task-pending-1 (proc-running-1), task-claimed-1 (proc-running-1),
//   task-completed-1 (proc-completed-1), task-pending-2 (proc-paused-1),
//   task-human-review (proc-human-waiting), task-upload-docs (proc-upload-waiting)
// - processInstances: proc-running-1 (Supply Chain Review), etc.
// - Test user has no custom claims (role = null), so useMyTasks(null) returns all tasks

test.describe('My Tasks', () => {
  test('[RENDER] page loads and shows heading', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: 'New actions' })).toBeVisible();
  });

  test('[RENDER] shows tasks in flat list by default', async ({ page }) => {
    await page.goto('/tasks');
    // Tasks are shown in a flat list by default (no grouping)
    await expect(page.getByText('Review Intake Data')).toBeVisible({ timeout: 10_000 });
    // Process names appear inline on each task row
    await expect(page.getByText('Supply Chain Review').first()).toBeVisible();
  });

  test('[RENDER] shows pending tasks with formatted step names', async ({ page }) => {
    await page.goto('/tasks');
    // task-pending-1 has stepId 'review-intake-data' → "Review Intake Data" in label
    await expect(page.getByText('Review Intake Data')).toBeVisible({ timeout: 10_000 });
  });

  test('[RENDER] Display popover opens and shows multi-select grouping', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByText('Review Intake Data')).toBeVisible({ timeout: 10_000 });
    // Click the Display button
    await page.getByRole('button', { name: /display/i }).click();
    // Group by options with checkmarks — use exact match to avoid matching task labels
    await expect(page.getByText('Workflow', { exact: true })).toBeVisible();
    await expect(page.getByText('Action', { exact: true })).toBeVisible();
  });

  test('[CLICK] toggling action grouping adds sub-groups within process cards', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByText('Review Intake Data')).toBeVisible({ timeout: 10_000 });
    // Enable action sub-grouping — use exact match
    await page.getByRole('button', { name: /display/i }).click();
    await page.getByText('Action', { exact: true }).click();
    // Action sub-group labels should appear within cards
    await expect(page.getByText('Action needed').first()).toBeVisible();
  });

  test('[CLICK] clicking task navigates to detail', async ({ page }) => {
    await page.goto('/tasks');
    await page.getByText('Review Intake Data').click({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/tasks\/task-pending-1/);
  });

  test('task detail page loads for pending task', async ({ page }) => {
    await page.goto('/tasks/task-human-review');
    await expect(page.getByText(/Human Review/)).toBeVisible();
    await expect(page.getByText(/pending/i)).toBeVisible();
    await expect(page.getByText('reviewer')).toBeVisible();
    await expect(page.getByText('unassigned')).not.toBeVisible();
  });

  test('task detail page shows action form for pending task (auto-assigned)', async ({ page }) => {
    await page.goto('/tasks/task-human-review');
    // Claiming removed — pending tasks show action forms directly
    await expect(page.getByRole('button', { name: /approve/i })).toBeVisible({ timeout: 10_000 });
  });

  test('task detail page shows previous step output', async ({ page }) => {
    await page.goto('/tasks/task-human-review');
    await page.getByText(/previous step output/i).click();
    await expect(page.getByRole('tab', { name: /summary/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /full output/i })).toBeVisible();
  });

  test('claimed task shows verdict buttons', async ({ page }) => {
    await page.goto('/tasks/task-claimed-1');
    await expect(page.getByRole('button', { name: /approve/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /revise/i })).toBeVisible();
  });

  test('completed task shows completion record', async ({ page }) => {
    await page.goto('/tasks/task-completed-1');
    await expect(page.getByText(/completed/i).first()).toBeVisible();
  });
});
