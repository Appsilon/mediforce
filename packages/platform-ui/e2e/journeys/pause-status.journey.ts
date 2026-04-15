import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Pause Status Labels & Resume Journey', () => {
  test('waiting_for_human shows "Waiting for action" badge and "Open task" CTA', async ({ page }, testInfo) => {
    await setupRecording(page, 'pause-status-waiting-human', testInfo);

    // Navigate to a process paused with waiting_for_human
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-human-waiting`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Badge says "Waiting for action" (not "paused")
    await expect(page.getByText('Waiting for action').first()).toBeVisible();

    // CTA to open the blocking task — no generic Resume button
    await expect(page.getByRole('link', { name: /open task/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /resume/i })).not.toBeVisible();
    await showResult(page);
  });

  test('agent_escalated shows "Waiting for action" badge and Resume button', async ({ page }, testInfo) => {
    await setupRecording(page, 'pause-status-agent-escalated', testInfo);

    // Navigate to a process paused with agent_escalated
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-paused-1`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Badge says "Waiting for action"
    await expect(page.getByText('Waiting for action').first()).toBeVisible();

    // Resume button is available (agent escalation has no dedicated UI, so generic resume)
    await expect(page.getByRole('button', { name: /resume/i })).toBeVisible();
    await showResult(page);
  });

  test('step_failure shows "Error" badge with details and Resume button', async ({ page }, testInfo) => {
    await setupRecording(page, 'pause-status-step-failure', testInfo);

    // Navigate to a process paused with step_failure
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-step-failure`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Badge says "Error" (not "paused")
    const badge = page.locator('.rounded-full').filter({ hasText: 'Error' });
    await expect(badge).toBeVisible();

    // Error banner with failure details
    await expect(page.getByText(/step failure/i)).toBeVisible();

    // Resume button is available
    await expect(page.getByRole('button', { name: /resume/i })).toBeVisible();
    await showResult(page);
  });

  test('clicking Resume on a blocked process restarts it', async ({ page }, testInfo) => {
    await setupRecording(page, 'pause-status-resume-flow', testInfo);

    // Navigate to the dedicated resume target (isolated from other tests)
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-resume-target`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });

    // Verify Error badge is visible before resuming
    const errorBadge = page.locator('.rounded-full').filter({ hasText: 'Error' });
    await expect(errorBadge).toBeVisible();
    await showStep(page);

    // Click Resume — the badge should change as the process transitions
    await page.getByRole('button', { name: /resume/i }).click();

    // After resume, the "Error" badge disappears (process moves to running or failed)
    await expect(errorBadge).not.toBeVisible({ timeout: 10_000 });

    // Resume button also disappears (process is no longer in resumable paused state)
    await expect(page.getByRole('button', { name: /resume/i })).not.toBeVisible({ timeout: 5_000 });
    await showResult(page);
    await endRecording(page);
  });
});
