import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Run Detail Journey', () => {
  test('running process shows step status panel and audit log tab', async ({ page }, testInfo) => {
    await setupRecording(page, 'run-detail-step-graph', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/in progress/i).first()).toBeVisible();
    await showStep(page);

    // All 7 non-terminal steps visible in the step status panel
    const expectedSteps = [
      'Vendor Assessment',
      'Narrative Summary',
      'Risk Scoring',
      'Data Quality Analysis',
      'Query Status Analysis',
      'Human Review',
      'Manager Approval',
    ];
    for (const stepName of expectedSteps) {
      await expect(page.getByText(stepName, { exact: true }).first()).toBeVisible();
    }

    // Step status panel has exactly 7 items
    const stepStatusPanel = page.locator('.bg-card').filter({ has: page.locator('h3', { hasText: 'Step Status' }) });
    await expect(stepStatusPanel.locator('ol > li')).toHaveCount(7);

    // Verdict labels visible in step status panel
    await expect(page.getByText('approve').first()).toBeVisible();
    await expect(page.getByText('request-actions')).toBeVisible();
    await expect(page.getByText('Archived').first()).toBeVisible();
    await showStep(page);

    // Right panel: Audit Log tab visible; no Step History tab (removed in two-panel redesign)
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

    // 2 non-terminal steps, both completed
    const stepStatusPanel = page.locator('.bg-card').filter({ has: page.locator('h3', { hasText: 'Step Status' }) });
    await expect(stepStatusPanel.locator('ol > li')).toHaveCount(2);
    const completedSteps = stepStatusPanel.locator('li').filter({ hasText: 'Completed' });
    await expect(completedSteps).toHaveCount(2);

    // Duration is visible for a completed run
    await expect(page.getByText(/duration/i)).toBeVisible();

    // Right panel: Audit Log tab in the two-panel layout
    await expect(page.getByRole('button', { name: /audit log/i })).toBeVisible();
    await showResult(page);
  });

  test('autonomy badges and executor identity labels', async ({ page }, testInfo) => {
    await setupRecording(page, 'run-detail-autonomy-badges', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-completed-2`);

    const stepStatusPanel = page.locator('.bg-card').filter({ has: page.locator('h3', { hasText: 'Step Status' }) });
    await expect(stepStatusPanel.locator('ol > li')).toHaveCount(7, { timeout: 10_000 });

    // Autonomy badges from WorkflowDefinition steps
    await expect(stepStatusPanel.getByText('L2').first()).toBeVisible();
    await expect(stepStatusPanel.getByText('L3').first()).toBeVisible();
    await showStep(page);

    // Executor identity labels: plugin name from WorkflowDefinition step
    await expect(stepStatusPanel.getByText('agent:supply-data-collector')).toBeVisible();
    await showStep(page);

    // Navigate to new-style workflow run (proc-workflow-run-1 uses WorkflowDefinition, no configName)
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-workflow-run-1`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });

    const wfStepPanel = page.locator('.bg-card').filter({ has: page.locator('h3', { hasText: 'Step Status' }) });
    await expect(wfStepPanel.locator('ol > li').first()).toBeVisible({ timeout: 10_000 });

    // Executor label uses plugin from the WorkflowDefinition step ('supply-data-collector')
    await expect(wfStepPanel.getByText('agent:supply-data-collector')).toBeVisible();
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
