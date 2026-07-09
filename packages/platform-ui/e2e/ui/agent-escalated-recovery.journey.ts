import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

test.describe('Agent Escalated Recovery Journey', () => {
  test('agent_escalated instance — Cancel this run flips status to Cancelled and removes the banner', async ({ page }) => {
    trackPageErrors(page);

    // proc-agent-escalated-cancel is seeded as:
    //   status=paused, pauseReason=agent_escalated, error='API rate limit exceeded...',
    //   currentStepId=human-review — isolated from proc-retry-test so cancelling
    //   does not pollute the retry journey.
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-agent-escalated-cancel`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });

    // Status badge shows "Waiting for human" (agent_escalated maps to waiting_for_human)
    await expect(page.getByText('Waiting for human').first()).toBeVisible();
    // AgentEscalatedBanner is visible with both action buttons
    await expect(page.getByRole('button', { name: /fixed, try again/i })).toBeVisible();
    const cancelButton = page.getByRole('button', { name: /cancel this run/i });
    await expect(cancelButton).toBeVisible();

    // Click "Cancel this run" — cancelProcess handler sets status=failed, error='Cancelled by user'
    await cancelButton.click();

    // Status badge flips to "Cancelled" (gray); AgentEscalatedBanner removed (instance no longer paused/agent_escalated)
    await expect(page.getByText(/^cancelled$/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(cancelButton).toHaveCount(0);
  });
});
