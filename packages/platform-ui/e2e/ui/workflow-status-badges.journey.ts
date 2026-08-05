import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

const STATUS_BADGES_WORKFLOW = 'Runs Page Journey Workflow';

test.describe('Workflow Status Badges Journey', () => {
  test('process list shows all five semantic status badges', async ({ page }) => {
    trackPageErrors(page);

    // The five runs for this workflow are dedicated to display-status coverage,
    // so the server-side workflow filter keeps parallel journeys from pushing
    // the Cancelled fixture past the first page of the shared namespace.
    await page.goto(`/${TEST_ORG_HANDLE}/runs?workflow=${encodeURIComponent(STATUS_BADGES_WORKFLOW)}`);
    await expect(page.getByText('All runs for this workflow.')).toBeVisible({ timeout: 30_000 });
    const rows = page.locator('tbody');
    await expect(rows.locator('tr')).toHaveCount(5);

    // Five display statuses visible in the list.
    await expect(rows.getByText('In Progress', { exact: true })).toBeVisible();
    await expect(rows.getByText('Waiting for human', { exact: true })).toBeVisible();
    await expect(rows.getByText('Error', { exact: true })).toBeVisible();
    await expect(rows.getByText('Completed', { exact: true })).toBeVisible();
    await expect(rows.getByText('Cancelled', { exact: true })).toBeVisible();
  });

  test('step_failure instance shows Error badge and error banner — no retry button', async ({ page }) => {
    trackPageErrors(page);

    // proc-step-failure is seeded as: status=paused, pauseReason=step_failure,
    // error='Docker container exited with code 1', currentStepId=human-review
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-step-failure`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });

    // Status badge shows "Error" (not "Paused")
    await expect(page.getByText(/^error$/i).first()).toBeVisible();

    // Error banner shows the specific error message from the instance
    await expect(page.getByText('Docker container exited with code 1')).toBeVisible();

    // No retry button — error state is terminal, steps cannot be re-run
    await expect(page.getByRole('button', { name: /run again this step/i })).toHaveCount(0);
  });

  test('waiting_for_human instance shows Waiting for human badge and amber banner', async ({ page }) => {
    trackPageErrors(page);

    // proc-human-waiting is seeded as: status=paused, pauseReason=waiting_for_human
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-human-waiting`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });

    // Status badge shows "Waiting for human" (not "Paused")
    await expect(page.getByText('Waiting for human').first()).toBeVisible();

    // No "Run again this step" button — waiting_for_human is not retryable
    await expect(page.getByRole('button', { name: /run again this step/i })).toHaveCount(0);
  });
});
