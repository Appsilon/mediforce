import { test, expect } from '@playwright/test';

// Uses seeded data from auth-setup.ts:
// - humanTasks: task-pending-1, task-claimed-1, task-completed-1, task-pending-2, task-human-review
// - processInstances: proc-human-waiting (paused at human-review) with step executions
// - Test user has no custom claims (role = null), so useMyTasks(null) returns all tasks

test.describe('My Tasks', () => {
  // TEST-02: E2E test — My Tasks shows task after process reaches human step
  test('My Tasks page shows pending tasks', async ({ page }) => {
    await page.goto('/tasks');
    // Page heading
    await expect(page.getByRole('heading', { name: 'My Tasks' })).toBeVisible();
    // Should show seeded task step IDs in the task list (default table view)
    await expect(page.getByText('review-intake-data')).toBeVisible();
  });

  test('My Tasks page shows active tab with count badge', async ({ page }) => {
    await page.goto('/tasks');
    // The active tab button should be visible
    const activeTab = page.getByRole('button', { name: /active/i });
    await expect(activeTab).toBeVisible();
  });

  test('task detail page loads for pending task', async ({ page }) => {
    // Navigate to task-human-review (linked to proc-human-waiting)
    await page.goto('/tasks/task-human-review');
    // Should show the formatted step name (Human Review)
    await expect(page.getByText(/Human Review/)).toBeVisible();
    // Should show pending status badge
    await expect(page.getByText(/pending/i)).toBeVisible();
    // Role must show a real role, not 'unassigned' (UAT gap #2)
    await expect(page.getByText('reviewer')).toBeVisible();
    await expect(page.getByText('unassigned')).not.toBeVisible();
  });

  test('task detail page shows claim button for pending task', async ({ page }) => {
    await page.goto('/tasks/task-human-review');
    // Claim button should be visible for pending tasks
    await expect(page.getByRole('button', { name: /claim/i })).toBeVisible();
  });

  test('task detail page shows previous step output', async ({ page }) => {
    // task-human-review is linked to proc-human-waiting which has step executions
    await page.goto('/tasks/task-human-review');
    // TaskContextPanel should show Summary and Full Output tabs
    await expect(page.getByRole('tab', { name: /summary/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /full output/i })).toBeVisible();
  });

  test('claimed task shows verdict buttons', async ({ page }) => {
    // task-claimed-1 is claimed by the test user and has step output from proc-running-1
    await page.goto('/tasks/task-claimed-1');
    // Should show Approve and Revise buttons
    await expect(page.getByRole('button', { name: /approve/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /revise/i })).toBeVisible();
  });

  test('completed task shows completion record', async ({ page }) => {
    // task-completed-1 has completionData
    await page.goto('/tasks/task-completed-1');
    await expect(page.getByText(/completed/i).first()).toBeVisible();
  });

  test('clicking task in list navigates to detail', async ({ page }) => {
    await page.goto('/tasks');
    // Click on task-pending-1's step ID link
    await page.getByText('review-intake-data').click();
    // Should navigate to the task detail page
    await expect(page).toHaveURL(/\/tasks\/task-pending-1/);
  });
});
