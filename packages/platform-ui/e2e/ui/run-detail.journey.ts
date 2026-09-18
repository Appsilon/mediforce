import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

test.describe('Run Detail Journey', () => {
  test('running process shows execution history panel and audit log tab', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/in progress/i).first()).toBeVisible();

    // Execution history shows only steps that have run — proc-running-1 has two
    // step executions: vendor-assessment (completed) and narrative-summary (running).
    const historyPanel = page.locator('.bg-card').filter({ has: page.locator('h3', { hasText: 'Execution History' }) });
    await expect(historyPanel.locator('ol > li')).toHaveCount(2);
    await expect(historyPanel.getByText('Vendor Assessment', { exact: true })).toBeVisible();
    await expect(historyPanel.getByText('Narrative Summary', { exact: true })).toBeVisible();

    // Right panel: each view has its own pull down the edge; opening one shows
    // the tab strip. No Step History tab.
    await expect(page.getByRole('button', { name: /^Log$/i }).first()).toBeVisible();
    await page.getByRole('button', { name: /^Log$/i }).first().click();
    await expect(page.getByRole('button', { name: /^Audit$/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /step history/i })).not.toBeVisible();
  });

  /**
   * The execution log is every step of the run, each one collapsible — there is
   * no "which step am I looking at" mode to be in. Two seeded step logs on
   * proc-running-1 make that visible: both are listed, and both their outputs
   * are reachable without switching anything.
   */
  test('execution log lists every step of the run', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });

    // The panel opens from its own tab down the edge, not a header button.
    await page.getByRole('button', { name: 'Log' }).first().click();

    // Both steps are listed, and a finished step opens on click.
    await expect(page.locator('[data-step-heading]', { hasText: 'vendor-assessment' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-step-heading]', { hasText: 'narrative-summary' })).toBeVisible();
    await page.locator('[data-step-heading]', { hasText: 'vendor-assessment' }).click();
    await expect(page.getByText('collect --vendors all')).toBeVisible({ timeout: 10_000 });

    // The task list is one live checklist, not a reprint per revision, and the
    // result echoing it back is not dumped as JSON.
    await expect(page.getByText('Collect vendor submissions')).toHaveCount(1);
    await expect(page.getByText(/\[\{"content":"Collect vendor submissions"/)).not.toBeVisible();

    // One "Done" per real completion — the `tool-calls` turn boundary in the
    // fixture is the model pausing to use a tool and must not add another.
    await expect(page.getByText('Done', { exact: true })).toHaveCount(2);
  });

  test('completed run shows results panel, duration, and completed steps', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Data%20Quality%20Review/runs/proc-completed-1`);

    // Step names visible
    await expect(page.getByText('Verify Data Quality', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Review Results', { exact: true }).first()).toBeVisible();

    // 2 executed steps, both completed. Rows no longer print the word
    // "Completed" — the status is the node's shape and the row shows a duration.
    const historyPanel = page.locator('.bg-card').filter({ has: page.locator('h3', { hasText: 'Execution History' }) });
    await expect(historyPanel.locator('ol > li')).toHaveCount(2);
    await expect(historyPanel.getByText('Verify Data Quality', { exact: true })).toBeVisible();
    await expect(historyPanel.getByText('Review Results', { exact: true })).toBeVisible();

    // Duration is visible for a completed run
    await expect(page.getByText('Duration', { exact: true })).toBeVisible();

    // Right panel: every run has an Audit pull, whether or not it wrote logs.
    await page.getByRole('button', { name: /^Audit$/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Audit' })).toBeVisible();
  });

  test('autonomy badges and executor identity labels', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-completed-2`);

    // proc-completed-2 has all 7 steps executed — count unchanged
    const historyPanel = page.locator('.bg-card').filter({ has: page.locator('h3', { hasText: 'Execution History' }) });
    await expect(historyPanel.locator('ol > li')).toHaveCount(7, { timeout: 10_000 });

    // Executor chips sourced from WorkflowDefinition steps (control mode labels, not raw L-levels)
    await expect(historyPanel.getByText('Assist').first()).toBeVisible();
    await expect(historyPanel.getByText('Human review').first()).toBeVisible();

    // Executor label uses plugin from the WorkflowDefinition step (vendor-assessment → supply-data-collector)
    await expect(historyPanel.getByText('agent:supply-data-collector')).toBeVisible();

    // Navigate to new-style run (proc-workflow-run-1 uses WorkflowDefinition, no configName).
    // No step executions exist yet, so only a virtual row for the current step (narrative-summary).
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-workflow-run-1`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });

    const wfHistoryPanel = page.locator('.bg-card').filter({ has: page.locator('h3', { hasText: 'Execution History' }) });
    await expect(wfHistoryPanel.locator('ol > li').first()).toBeVisible({ timeout: 10_000 });

    // Virtual row shows the current step name and executor chip (narrative-summary → Human review)
    await expect(wfHistoryPanel.getByText('Narrative Summary', { exact: true })).toBeVisible();
    await expect(wfHistoryPanel.getByText('Human review').first()).toBeVisible();
  });

  test('duration hidden while running, visible when completed', async ({ page }) => {
    trackPageErrors(page);

    // Running process: Duration metadata field must NOT appear
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Duration', { exact: true })).not.toBeVisible();

    // Completed process: Duration metadata field IS visible
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Data%20Quality%20Review/runs/proc-completed-1`);
    await expect(page.getByRole('heading', { name: 'Data Quality Review' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Duration', { exact: true })).toBeVisible();
  });
});
