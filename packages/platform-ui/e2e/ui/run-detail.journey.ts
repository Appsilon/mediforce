import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Run Detail Journey', () => {
  test('running process shows execution history panel and audit log tab', async ({ page }, testInfo) => {
    await setupRecording(page, 'run-detail-step-graph', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/in progress/i).first()).toBeVisible();
    await showStep(page);

    // Execution history shows only steps that have run — proc-running-1 has two
    // step executions: vendor-assessment (completed) and narrative-summary (running).
    const historyPanel = page.locator('.bg-card').filter({ has: page.locator('h3', { hasText: 'Execution History' }) });
    await expect(historyPanel.locator('ol > li')).toHaveCount(2);
    await expect(historyPanel.getByText('Vendor Assessment', { exact: true })).toBeVisible();
    await expect(historyPanel.getByText('Narrative Summary', { exact: true })).toBeVisible();
    await showStep(page);

    // Right panel: "Execution Log" button always visible; clicking opens the panel
    // with the Audit Log tab. No Step History tab.
    await expect(page.getByRole('button', { name: /^Execution Log$/i })).toBeVisible();
    await click(page, page.getByRole('button', { name: /^Execution Log$/i }));
    await expect(page.getByRole('button', { name: /audit log/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /step history/i })).not.toBeVisible();
    await showResult(page);
  });

  test('completed run shows results panel, duration, and completed steps', async ({ page }, testInfo) => {
    await setupRecording(page, 'run-detail-completed', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Data%20Quality%20Review/runs/proc-completed-1`);

    // Step names visible
    await expect(page.getByText('Verify Data Quality', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Review Results', { exact: true }).first()).toBeVisible();
    await showStep(page);

    // 2 executed steps, both completed
    const historyPanel = page.locator('.bg-card').filter({ has: page.locator('h3', { hasText: 'Execution History' }) });
    await expect(historyPanel.locator('ol > li')).toHaveCount(2);
    const completedSteps = historyPanel.locator('li').filter({ hasText: 'Completed' });
    await expect(completedSteps).toHaveCount(2);

    // Duration is visible for a completed run
    await expect(page.getByText(/^Duration:/i)).toBeVisible();

    // Right panel: expand via "Execution Log", then Audit Log tab is visible
    await click(page, page.getByRole('button', { name: /^Execution Log$/i }));
    await expect(page.getByRole('button', { name: /audit log/i })).toBeVisible();
    await showResult(page);
  });

  test('autonomy badges and executor identity labels', async ({ page }, testInfo) => {
    await setupRecording(page, 'run-detail-autonomy-badges', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-completed-2`);

    // proc-completed-2 has all 7 steps executed — count unchanged
    const historyPanel = page.locator('.bg-card').filter({ has: page.locator('h3', { hasText: 'Execution History' }) });
    await expect(historyPanel.locator('ol > li')).toHaveCount(7, { timeout: 10_000 });

    // Autonomy badges sourced from WorkflowDefinition steps
    await expect(historyPanel.getByText('L2').first()).toBeVisible();
    await expect(historyPanel.getByText('L3').first()).toBeVisible();
    await showStep(page);

    // Executor label uses plugin from the WorkflowDefinition step (vendor-assessment → supply-data-collector)
    await expect(historyPanel.getByText('agent:supply-data-collector')).toBeVisible();
    await showStep(page);

    // Navigate to new-style run (proc-workflow-run-1 uses WorkflowDefinition, no configName).
    // No step executions exist yet, so only a virtual row for the current step (narrative-summary).
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-workflow-run-1`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });

    const wfHistoryPanel = page.locator('.bg-card').filter({ has: page.locator('h3', { hasText: 'Execution History' }) });
    await expect(wfHistoryPanel.locator('ol > li').first()).toBeVisible({ timeout: 10_000 });

    // Virtual row shows the current step name and WD-sourced autonomy badge (narrative-summary → L3)
    await expect(wfHistoryPanel.getByText('Narrative Summary', { exact: true })).toBeVisible();
    await expect(wfHistoryPanel.getByText('L3').first()).toBeVisible();
    await showResult(page);
    await endRecording(page);
  });

  test('duration hidden while running, visible when completed', async ({ page }, testInfo) => {
    await setupRecording(page, 'run-detail-duration-visibility', testInfo);

    // Running process: Duration metadata field must NOT appear
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/^Duration:/i)).not.toBeVisible();
    await showStep(page);

    // Completed process: Duration metadata field IS visible
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Data%20Quality%20Review/runs/proc-completed-1`);
    await expect(page.getByRole('heading', { name: 'Data Quality Review' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/^Duration:/i)).toBeVisible();
    await showResult(page);
  });
});
