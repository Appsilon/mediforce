import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Agent Escalated Recovery Journey', () => {
  test('agent_escalated instance — Cancel this run flips status to Error and removes the banner', async ({ page }, testInfo) => {
    await setupRecording(page, 'agent-escalated-cancel', testInfo);

    // proc-agent-escalated-cancel is seeded as:
    //   status=paused, pauseReason=agent_escalated, error='API rate limit exceeded...',
    //   currentStepId=human-review — isolated from proc-retry-test so cancelling
    //   does not pollute the retry journey.
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-agent-escalated-cancel`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Status badge shows "Waiting for human" (agent_escalated maps to waiting_for_human)
    await expect(page.getByText('Waiting for human').first()).toBeVisible();
    // AgentEscalatedBanner is visible with both action buttons
    await expect(page.getByRole('button', { name: /fixed, try again/i })).toBeVisible();
    const cancelButton = page.getByRole('button', { name: /cancel this run/i });
    await expect(cancelButton).toBeVisible();
    await showStep(page);

    // Click "Cancel this run" — cancelProcessRun sets status=failed, error='Cancelled by user'
    await click(page, cancelButton);

    // Status badge flips to "Error"; AgentEscalatedBanner removed (instance no longer paused/agent_escalated)
    await expect(page.getByText(/^error$/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(cancelButton).toHaveCount(0);
    await showResult(page);

    await endRecording(page);
  });
});
