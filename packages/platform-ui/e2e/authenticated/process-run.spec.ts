import { test, expect } from '@playwright/test';
import { TEST_ORG_HANDLE } from '../helpers/constants';

// Uses seeded data from auth-setup.ts:
// - 'proc-running-1' is a running instance with stepExecutions subcollection seeded
// - definitionName: 'Supply Chain Review', definitionVersion: '1.0.0'
// - stepExecutions: 'exec-intake' (completed), 'exec-intake-review' (running)

test.describe('Process Run Detail', () => {
  test('run detail page loads and shows process name', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible();
  });

  test('run detail page shows status badge', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);
    // 'proc-running-1' has status: 'running'
    await expect(page.getByText(/running/i).first()).toBeVisible();
  });

  test('run detail page shows step history tab', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);
    await expect(page.getByRole('tab', { name: /step history/i })).toBeVisible();
  });

  test('run detail page shows audit log tab', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);
    await expect(page.getByRole('tab', { name: /audit log/i })).toBeVisible();
  });

  test('run detail page shows cancel button for running instance', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);
    await expect(page.getByRole('button', { name: /^cancel$/i })).toBeVisible();
  });

  test('cancel button shows double-confirm on first click', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);
    await page.getByRole('button', { name: /^cancel$/i }).click();
    // After first click, a confirmation prompt should appear
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /confirm cancel/i })).toBeVisible();
  });

  test('cancel confirm can be dismissed with Back button', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();
    await page.getByRole('button', { name: /^back$/i }).click();
    // Returns to idle state — cancel button visible again
    await expect(page.getByRole('button', { name: /^cancel$/i })).toBeVisible();
  });

  // --- Step graph visualization tests (10-02) ---

  test('step graph shows all non-terminal step names', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);

    // All non-terminal steps from the Supply Chain Review definition should be visible
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
      await expect(page.getByText(stepName, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    }

    // Terminal step 'Archived' should NOT appear as its own step in the graph (7 non-terminal steps only)
    // Note: 'Archived' text does appear inside the Manager Approval verdict sub-list, which is expected
    const stepStatusPanel = page.locator('.bg-card').filter({ has: page.locator('h3', { hasText: 'Step Status' }) });
    await expect(stepStatusPanel.locator('ol > li')).toHaveCount(7, { timeout: 10_000 });
  });

  test('active step has colored left border accent', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);

    // Scope to the Step Status panel to avoid matching step history items
    const stepStatusPanel = page.locator('.bg-card').filter({ has: page.locator('h3', { hasText: 'Step Status' }) });

    // The active step is 'narrative-summary' which should show 'Running' status
    const runningStep = stepStatusPanel.locator('li').filter({ hasText: 'Running' });
    await expect(runningStep.first()).toBeVisible({ timeout: 10_000 });

    // Running step should have a blue left border accent (border-l-4 border-blue-500)
    await expect(runningStep.first()).toHaveClass(/border-l-4/);
    await expect(runningStep.first()).toHaveClass(/border-blue/);
  });

  test('completed steps are visually dimmed', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);

    // Scope to the Step Status panel to avoid matching step history items
    const stepStatusPanel = page.locator('.bg-card').filter({ has: page.locator('h3', { hasText: 'Step Status' }) });

    // 'Vendor Assessment' should show as completed (from exec-intake)
    const completedStep = stepStatusPanel.locator('li').filter({ hasText: 'Completed' });
    await expect(completedStep.first()).toBeVisible({ timeout: 10_000 });

    // Completed step should have opacity-60 class for dimming
    await expect(completedStep.first()).toHaveClass(/opacity-60/);
  });

  test('step graph shows verdict labels for review steps', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);

    // The Manager Approval step (type: review) has verdicts: approve and request-actions
    // Verdict labels should be visible with target step names
    await expect(page.getByText('approve').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('request-actions')).toBeVisible({ timeout: 10_000 });
    // Target step name 'Archived' should appear in the verdict sub-list
    await expect(page.getByText('Archived').first()).toBeVisible({ timeout: 10_000 });
  });

  test('step history tab shows execution entries', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`);

    // Click the Step History tab
    await page.getByRole('tab', { name: /step history/i }).click();

    // The step history timeline should show execution entries with step IDs and status badges
    // Look for the Timeline sub-tab content with step execution data-step-id attributes
    const historyEntries = page.locator('[data-step-id]');
    await expect(historyEntries).toHaveCount(2, { timeout: 10_000 });

    // Verify the specific step IDs appear as step history entries
    await expect(page.locator('[data-step-id="vendor-assessment"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-step-id="narrative-summary"]')).toBeVisible({ timeout: 10_000 });
  });

  test('completed process run shows all steps in graph', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Data%20Quality%20Review/runs/proc-completed-1`);

    // Non-terminal step names should be visible
    await expect(page.getByText('Verify Data Quality', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Review Results', { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    // Data Quality Review has 2 non-terminal steps, terminal 'Done' is filtered out
    const stepStatusPanel = page.locator('.bg-card').filter({ has: page.locator('h3', { hasText: 'Step Status' }) });
    await expect(stepStatusPanel.locator('ol > li')).toHaveCount(2, { timeout: 10_000 });

    // Both steps should show 'Completed' status since proc-completed-1 has both step executions
    const completedSteps = stepStatusPanel.locator('li').filter({ hasText: 'Completed' });
    await expect(completedSteps).toHaveCount(2, { timeout: 10_000 });
  });

  test('taken verdict branch has distinct styling on completed review step', async ({ page }) => {
    // proc-completed-2 is a completed Supply Chain Review process with
    // manager-approval step execution that has verdict: 'approve'
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-completed-2`);

    // Wait for step graph to render
    const stepStatusPanel = page.locator('.bg-card').filter({
      has: page.locator('h3', { hasText: 'Step Status' }),
    });
    await expect(stepStatusPanel.locator('ol > li')).toHaveCount(7, { timeout: 10_000 });

    // Manager Approval step should show verdict branches
    // The 'approve' verdict should have taken styling (font-medium class)
    const managerApprovalStep = stepStatusPanel.locator('li').filter({
      hasText: 'Manager Approval',
    });
    await expect(managerApprovalStep).toBeVisible({ timeout: 10_000 });

    // Find the verdict branch divs within Manager Approval
    // Each verdict is a div.text-xs with child spans: <span>verdictName</span> <span>arrow</span> <span>target</span>
    // 'approve' should be font-medium (taken), 'request-actions' should NOT be font-medium (untaken)
    const approveVerdict = managerApprovalStep.locator('div.text-xs', {
      has: page.locator('span', { hasText: 'approve' }),
    }).filter({ hasNotText: 'request-actions' }).first();
    const requestActionsVerdict = managerApprovalStep.locator('div.text-xs', {
      has: page.locator('span', { hasText: 'request-actions' }),
    }).first();

    await expect(approveVerdict).toHaveClass(/font-medium/, { timeout: 10_000 });
    await expect(requestActionsVerdict).not.toHaveClass(/font-medium/);
  });

  test('[DATA] Step status panel shows autonomy badges for agent steps', async ({ page }) => {
    // proc-completed-2 is a completed Supply Chain Review process
    // The processConfig seeds L4 for vendor-assessment and L2 for narrative-summary
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-completed-2`);

    // Wait for step graph to render
    const stepStatusPanel = page.locator('.bg-card').filter({
      has: page.locator('h3', { hasText: 'Step Status' }),
    });
    await expect(stepStatusPanel.locator('ol > li')).toHaveCount(7, { timeout: 10_000 });

    // Verify autonomy badge L4 is visible (Vendor Assessment step)
    await expect(stepStatusPanel.getByText('L4').first()).toBeVisible({ timeout: 10_000 });
    // Verify autonomy badge L2 is visible (Narrative Summary step)
    await expect(stepStatusPanel.getByText('L2').first()).toBeVisible({ timeout: 10_000 });
  });

  test('step history shows execution entries for completed process', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Data%20Quality%20Review/runs/proc-completed-1`);

    // Click the Step History tab explicitly
    await page.getByRole('tab', { name: /step history/i }).click();

    // Verify step execution entries are visible via data-step-id attributes
    await expect(page.locator('[data-step-id="verify-data-quality"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-step-id="review-results"]')).toBeVisible({ timeout: 10_000 });
  });

  // Regression: new-style runs (WorkflowDefinition, no configName) must also show step panel
  test('[DATA] new-style workflow run shows step status panel', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-workflow-run-1`);

    // Should load the run detail page
    await expect(page.getByRole('heading', { name: 'Supply Chain Review' })).toBeVisible({ timeout: 10_000 });

    // Step status panel should render with steps from workflowDefinitions
    // The seeded workflowDefinition has steps: vendor-assessment, narrative-summary, risk-scoring, human-review, done
    const stepPanel = page.locator('[data-testid="step-status-panel"]').or(page.locator('text=/Vendor Assessment|Narrative Summary|Risk Scoring/i'));
    await expect(stepPanel.first()).toBeVisible({ timeout: 10_000 });
  });
});
