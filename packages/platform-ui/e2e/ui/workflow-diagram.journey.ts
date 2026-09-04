import type { Page } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

const BRANCH_FAN_OUT_URL = `/${TEST_ORG_HANDLE}/workflows/Diagram%20Branch%20Fan%20Out/definitions/1`;
const BACK_EDGE_URL = `/${TEST_ORG_HANDLE}/workflows/Diagram%20Back%20Edge/definitions/1`;

const nodeNamed = (page: Page, name: string | RegExp) =>
  page.locator('.react-flow__node').filter({ hasText: name });

test.describe('Workflow Diagram Journey', () => {
  // ── Branch fan-out ──────────────────────────────────────────────────────────

  test('both sides of a decision are on the canvas at once, in their own columns', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(BRANCH_FAN_OUT_URL);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    // Each condition labels the arrow it guards.
    await expect(page.getByText('type = "standard"')).toBeVisible();
    await expect(page.getByText('type = "urgent"')).toBeVisible();

    // Neither branch is hidden behind a choice the reader has to make first.
    const standard = nodeNamed(page, 'Standard Processing');
    const urgent = nodeNamed(page, 'Urgent Processing');
    await expect(standard).toBeVisible();
    await expect(urgent).toBeVisible();

    // Drawing both means placing both: the two branches sit side by side rather
    // than stacked on the same spot.
    const standardBox = (await standard.boundingBox())!;
    const urgentBox = (await urgent.boundingBox())!;
    const sideBySide =
      standardBox.x + standardBox.width <= urgentBox.x || urgentBox.x + urgentBox.width <= standardBox.x;
    expect(sideBySide, `branches overlap: ${JSON.stringify({ standardBox, urgentBox })}`).toBe(true);

    // The step both branches merge into is below them both, drawn once.
    const finalize = nodeNamed(page, 'Finalize');
    await expect(finalize).toHaveCount(1);
    const finalizeBox = (await finalize.boundingBox())!;
    expect(finalizeBox.y).toBeGreaterThan(Math.max(standardBox.y, urgentBox.y));
  });

  // ── Back edges ──────────────────────────────────────────────────────────────

  test('a loop back is a row naming its target plus a dashed arc, not a hidden branch', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(BACK_EDGE_URL);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    // `approve` goes forward, so it is a labelled arrow into the step it reaches.
    await expect(page.locator('.react-flow__edges').getByText('approve', { exact: true })).toBeVisible();

    // `revise` loops back, so it is a row on the Review card that names where it
    // returns to — the one thing an arc curving off the side cannot say.
    const reviseRow = page.locator('[title="Loops back to Draft Document"]');
    await expect(reviseRow).toBeVisible();
    await expect(reviseRow).toContainText('revise');
    await expect(reviseRow.locator('svg.lucide-arrow-right')).toBeVisible();

    // Both ends of the loop, and the step past it, are all on the canvas.
    await expect(nodeNamed(page, 'Draft Document')).toBeVisible();
    await expect(nodeNamed(page, 'Review Document')).toBeVisible();
    await expect(nodeNamed(page, /^Done$/)).toBeVisible();

    // The arc itself: ReactFlow renders back edges dashed.
    const backEdge = page.locator('.react-flow__edges path[style*="stroke-dasharray"]');
    await expect(backEdge.first()).toBeVisible({ timeout: 5_000 });
  });
});
