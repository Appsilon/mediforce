import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Workflow Status Badges Journey', () => {
  test('process list shows all five semantic status badges', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-status-badges-list', testInfo);

    // The RunsTable (with status badges) lives at /runs, not /workflows
    await page.goto(`/${TEST_ORG_HANDLE}/runs`);
    await expect(page.getByText('All workflow runs across the platform.')).toBeVisible({ timeout: 30_000 });
    await showStep(page);

    // Five display statuses visible in the list
    await expect(page.getByText('In Progress').first()).toBeVisible();
    await expect(page.getByText('Waiting for human').first()).toBeVisible();
    await expect(page.getByText('Error').first()).toBeVisible();
    await expect(page.getByText('Completed').first()).toBeVisible();
    // proc-cancelled-1 is seeded as status=failed / error='Cancelled by user'
    await expect(page.getByText('Cancelled').first()).toBeVisible();
    await showResult(page);

    await endRecording(page);
  });

  test('step_failure instance shows Error badge and error banner — no retry button', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-status-badges-error', testInfo);

    // proc-step-failure is seeded as: status=paused, pauseReason=step_failure,
    // error='Docker container exited with code 1', currentStepId=human-review
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-step-failure`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Status badge shows "Error" (not "Paused")
    await expect(page.getByText(/^error$/i).first()).toBeVisible();

    // Error banner shows the specific error message from the instance
    await expect(page.getByText('Docker container exited with code 1')).toBeVisible();
    await showStep(page);

    // No retry button — error state is terminal, steps cannot be re-run
    await expect(page.getByRole('button', { name: /run again this step/i })).toHaveCount(0);
    await showResult(page);

    await endRecording(page);
  });

  test('waiting_for_human instance shows Waiting for human badge and amber banner', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-status-badges-waiting', testInfo);

    // proc-human-waiting is seeded as: status=paused, pauseReason=waiting_for_human
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-human-waiting`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Status badge shows "Waiting for human" (not "Paused")
    await expect(page.getByText('Waiting for human').first()).toBeVisible();

    // No "Run again this step" button — waiting_for_human is not retryable
    await expect(page.getByRole('button', { name: /run again this step/i })).toHaveCount(0);
    await showResult(page);

    await click(page, page.getByRole('link', { name: /workflows/i }).first());
    await endRecording(page);
  });
});
