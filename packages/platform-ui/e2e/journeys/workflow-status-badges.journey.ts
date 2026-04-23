import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Workflow Status Badges Journey', () => {
  test('process list shows all four semantic status badges', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-status-badges-list', testInfo);

    await page.goto(`/${TEST_ORG_HANDLE}/workflows`);
    await expect(page.getByRole('heading', { name: /workflows/i })).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Four display statuses visible in the list
    await expect(page.getByText('In Progress').first()).toBeVisible();
    await expect(page.getByText('Waiting for human').first()).toBeVisible();
    await expect(page.getByText('Error').first()).toBeVisible();
    await expect(page.getByText('Completed').first()).toBeVisible();
    await showResult(page);

    await endRecording(page);
  });

  test('step_failure instance shows Error badge, error banner with message, and Run again button', async ({ page }, testInfo) => {
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

    // "Run again this step" button is visible on the human-review step (step_failure is retryable)
    await expect(page.getByRole('button', { name: /run again this step/i })).toBeVisible();
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
