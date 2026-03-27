import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Run Detail Journey', () => {
  test('running process shows step graph, step history, and tabs', async ({ page }, testInfo) => {
    await setupRecording(page, 'run-detail-step-graph', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/running/i).first()).toBeVisible();
    await showStep(page);

    // All 7 non-terminal steps visible
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

    // Verdict labels visible
    await expect(page.getByText('approve').first()).toBeVisible();
    await expect(page.getByText('request-actions')).toBeVisible();
    await expect(page.getByText('Archived').first()).toBeVisible();
    await showStep(page);

    // Click Step History tab
    await click(page, page.getByRole('tab', { name: /step history/i }));
    const historyEntries = page.locator('[data-step-id]');
    await expect(historyEntries).toHaveCount(2, { timeout: 10_000 });
    await expect(page.locator('[data-step-id="vendor-assessment"]')).toBeVisible();
    await expect(page.locator('[data-step-id="narrative-summary"]')).toBeVisible();
    await showStep(page);

    // Audit Log tab visible
    await expect(page.getByRole('tab', { name: /audit log/i })).toBeVisible();
    await showResult(page);
  });

  test('completed run shows all steps completed and step history', async ({ page }, testInfo) => {
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

    // Step History tab
    await click(page, page.getByRole('tab', { name: /step history/i }));
    await expect(page.locator('[data-step-id="verify-data-quality"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-step-id="review-results"]')).toBeVisible();
    await showResult(page);
  });

  test('autonomy badges and new-style workflow run', async ({ page }, testInfo) => {
    await setupRecording(page, 'run-detail-autonomy-badges', testInfo);
    // proc-completed-2 has processConfig with L4, L2
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-completed-2`);

    const stepStatusPanel = page.locator('.bg-card').filter({ has: page.locator('h3', { hasText: 'Step Status' }) });
    await expect(stepStatusPanel.locator('ol > li')).toHaveCount(7, { timeout: 10_000 });

    // Autonomy badges
    await expect(stepStatusPanel.getByText('L4').first()).toBeVisible();
    await expect(stepStatusPanel.getByText('L2').first()).toBeVisible();
    await showStep(page);

    // Navigate to new-style workflow run (no configName)
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-workflow-run-1`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });

    // Step status panel renders
    const stepPanel = page
      .locator('[data-testid="step-status-panel"]')
      .or(page.locator('text=/Vendor Assessment|Narrative Summary|Risk Scoring/i'));
    await expect(stepPanel.first()).toBeVisible({ timeout: 10_000 });
    await showResult(page);
    await endRecording(page);
  });
});
