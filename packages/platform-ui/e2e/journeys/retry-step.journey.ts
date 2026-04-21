import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Retry Failed Step Journey', () => {
  test('clicking Retry flips a failed instance back to running and the auto-runner re-dispatches the step', async ({ page }, testInfo) => {
    await setupRecording(page, 'retry-step', testInfo);

    // proc-retry-test is seeded with:
    //   status=failed, currentStepId=human-review, latest execution status=failed
    // so retryStep's three guards (status, currentStepId, execution.status) are satisfied.
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-retry-test`);

    // Initial state: Retry button visible on the failed human-review step
    const retryButton = page.getByRole('button', { name: /^retry$/i });
    await expect(retryButton).toBeVisible({ timeout: 10_000 });
    // Instance badge shows "failed" before retry
    await expect(page.getByText(/^failed$/i).first()).toBeVisible();
    await showStep(page);

    // Click Retry — server action calls engine.retryStep (flips status→running, clears error)
    // and fire-and-forgets POST /run which re-enters the auto-runner loop.
    await click(page, retryButton);

    // Auto-runner hits executor='human' for human-review, creates a new HumanTask,
    // and pauses the instance with pauseReason='waiting_for_human'. The status badge
    // flips from "Failed" to "Waiting". This proves the retry mechanism fired AND
    // the auto-runner re-dispatched the step — without requiring any plugin or Docker.
    await expect(page.getByText(/^waiting$/i).first()).toBeVisible({ timeout: 20_000 });
    // Retry button should no longer be visible — the step is no longer 'failed'
    await expect(retryButton).toHaveCount(0);
    await showResult(page);
    await endRecording(page);
  });
});
