import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Retry Failed Step Journey', () => {
  test('agent_escalated instance — Fixed try again retries the step and flips banner to waiting_for_human', async ({ page }, testInfo) => {
    await setupRecording(page, 'retry-step', testInfo);

    // proc-retry-test is seeded as:
    //   status=paused, pauseReason=agent_escalated, error='Simulated step failure...',
    //   currentStepId=human-review, latest stepExecution status=failed
    // so engine.retryStep's three guards (paused+agent_escalated, currentStepId, execution.status) are satisfied.
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-retry-test`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });

    // Initial state: "Waiting for human" badge (agent_escalated maps to waiting_for_human display status)
    await expect(page.getByText('Waiting for human').first()).toBeVisible();
    // AgentEscalatedBanner shows "Fixed, try again" button
    const retryButton = page.getByRole('button', { name: /fixed, try again/i });
    await expect(retryButton).toBeVisible();
    await showStep(page);

    // Click "Fixed, try again" — server action calls engine.retryStep (flips status→running,
    // clears pauseReason/error) and fire-and-forgets POST /run which re-enters the auto-runner.
    await click(page, retryButton);

    // Auto-runner hits executor='human' for human-review, creates a new HumanTask,
    // and pauses with pauseReason='waiting_for_human'. "Waiting for human" badge remains
    // visible (now from the human task, not agent escalation). AgentEscalatedBanner
    // disappears because rawReason is no longer 'agent_escalated'.
    await expect(page.getByText('Waiting for human').first()).toBeVisible({ timeout: 20_000 });
    await expect(retryButton).toHaveCount(0);
    await showResult(page);

    await endRecording(page);
  });
});
