import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

const BRANCH_ACCORDION_URL = `/${TEST_ORG_HANDLE}/workflows/Diagram%20Branch%20Accordion/definitions/1`;
const BACK_EDGE_URL = `/${TEST_ORG_HANDLE}/workflows/Diagram%20Back%20Edge/definitions/1`;

test.describe('Workflow Diagram Journey', () => {
  // ── Branch accordion ────────────────────────────────────────────────────────

  test('branch accordion shows all buttons and expands first branch by default', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-diagram-branch-accordion', testInfo);
    await page.goto(BRANCH_ACCORDION_URL);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Both condition buttons are visible
    await expect(page.getByText('type = "standard"')).toBeVisible();
    await expect(page.getByText('type = "urgent"')).toBeVisible();
    await showStep(page);

    // First branch (standard) is expanded: Standard Processing node is in the diagram
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Standard Processing' })).toBeVisible();

    // Second branch (urgent) is collapsed: Urgent Processing NOT in the diagram
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Urgent Processing' })).not.toBeVisible();

    // The first button is active (has ChevronDown, not ChevronRight)
    const standardButton = page.locator('button').filter({ hasText: /type = "standard"/ });
    await expect(standardButton.locator('svg.lucide-chevron-down')).toBeVisible();

    // The second button is inactive (has ChevronRight)
    const urgentButton = page.locator('button').filter({ hasText: /type = "urgent"/ });
    await expect(urgentButton.locator('svg.lucide-chevron-right')).toBeVisible();
    await showResult(page);

    await endRecording(page);
  });

  test('clicking inactive branch button switches the expanded branch', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-diagram-branch-switch', testInfo);
    await page.goto(BRANCH_ACCORDION_URL);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    // Standard Processing is visible (branch 1 active)
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Standard Processing' })).toBeVisible();
    await showStep(page);

    // Click the urgent branch button
    const urgentButton = page.locator('button').filter({ hasText: /type = "urgent"/ });
    await click(page, urgentButton);
    await showStep(page);

    // Urgent Processing now appears in the diagram
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Urgent Processing' })).toBeVisible({ timeout: 5_000 });

    // Standard Processing is now hidden
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Standard Processing' })).not.toBeVisible();

    // Urgent button is now active (ChevronDown)
    await expect(urgentButton.locator('svg.lucide-chevron-down')).toBeVisible();
    await showResult(page);

    await endRecording(page);
  });

  // ── Back-edge buttons ───────────────────────────────────────────────────────

  test('back-edge verdict shows amber return button and arc to earlier step', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-diagram-back-edge', testInfo);
    await page.goto(BACK_EDGE_URL);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Forward branch button "approve" is visible with ChevronDown (active, leads to Done)
    const approveButton = page.locator('button').filter({ hasText: /^approve$/ });
    await expect(approveButton).toBeVisible();
    await expect(approveButton.locator('svg.lucide-chevron-down')).toBeVisible();
    await showStep(page);

    // Back-edge button "revise" is visible with amber ArrowUp icon
    const reviseButton = page.locator('button').filter({ hasText: /^revise$/ });
    await expect(reviseButton).toBeVisible();
    await expect(reviseButton.locator('svg.lucide-arrow-up')).toBeVisible();
    await showStep(page);

    // The "Done" terminal step is visible (follow-through from approve branch)
    await expect(page.locator('.react-flow__node').filter({ hasText: /^Done$/ })).toBeVisible();

    // Back-edge arc exists in the SVG (dashed amber edge from revise button to draft)
    // ReactFlow renders back-edges with stroke-dasharray style on the path element
    const backEdge = page.locator('.react-flow__edges path[style*="stroke-dasharray"]');
    await expect(backEdge.first()).toBeVisible({ timeout: 5_000 });
    await showResult(page);

    await endRecording(page);
  });
});
