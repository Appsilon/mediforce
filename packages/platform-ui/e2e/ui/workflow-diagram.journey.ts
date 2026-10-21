import type { Page } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

const BRANCH_FAN_OUT_URL = `/${TEST_ORG_HANDLE}/workflows/Diagram%20Branch%20Fan%20Out/definitions/1`;
const BACK_EDGE_URL = `/${TEST_ORG_HANDLE}/workflows/Diagram%20Back%20Edge/definitions/1`;
const LOOP_RUN_URL = `/${TEST_ORG_HANDLE}/workflows/Diagram%20Back%20Edge/runs/proc-diagram-loop-1`;
const ORCHESTRATOR_URL = `/${TEST_ORG_HANDLE}/workflows/Diagram%20Orchestrator/definitions/1`;
const ORCHESTRATOR_RUN_URL = `/${TEST_ORG_HANDLE}/workflows/Diagram%20Orchestrator/runs/proc-diagram-orchestrator-1`;

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

  // ── Run replay ──────────────────────────────────────────────────────────────

  test('a run\'s diagram shows the path it took and replays it as a ball', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(LOOP_RUN_URL);
    await page.getByRole('button', { name: 'Diagram' }).first().click();
    const controls = page.getByTestId('run-replay-controls');
    await expect(controls).toBeVisible({ timeout: 10_000 });

    // Opens on the end of the run: every hop taken, the loop counted on the arrow ridden twice.
    await expect(page.getByTestId('run-replay-position')).toHaveText('Hop 3 of 3 · Review Document');
    await expect(page.locator('.react-flow__edges').getByText('×2')).toBeVisible();

    await controls.getByRole('radio', { name: 'Path only' }).click();
    await controls.getByRole('button', { name: /Replay run/ }).click();
    await expect(page.getByTestId('replay-ball')).toBeVisible({ timeout: 5_000 });
    await expect(controls.getByRole('button', { name: /Replay run/ })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('run-replay-position')).toHaveText('Hop 3 of 3 · Review Document');
  });

  // ── Child workflows ─────────────────────────────────────────────────────────

  test('a run-workflow step opens to draw the child workflow\'s steps inside it', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(ORCHESTRATOR_URL);
    const phase = nodeNamed(page, 'Run Readiness Phase').first();
    await expect(phase).toBeVisible({ timeout: 10_000 });
    await expect(nodeNamed(page, 'Collect Evidence')).toHaveCount(0);

    await phase.getByRole('button', { name: 'Expand child workflow' }).click();

    // The child's runnable version, named and linked, with its steps drawn in the frame.
    const frame = page.getByTestId('child-workflow-frame');
    await expect(frame.getByRole('link', { name: 'Diagram Child Phase v1' })).toHaveAttribute(
      'href',
      `/${TEST_ORG_HANDLE}/workflows/Diagram%20Child%20Phase/definitions/1`,
    );
    await expect(nodeNamed(page, 'Collect Evidence')).toBeVisible({ timeout: 10_000 });
    await expect(nodeNamed(page, 'Assess Readiness')).toBeVisible();

    // The step past the phase is pushed below the frame rather than drawn over it.
    const frameBox = (await frame.boundingBox())!;
    const doneBox = (await nodeNamed(page, /^Done$/).first().boundingBox())!;
    expect(doneBox.y).toBeGreaterThan(frameBox.y + frameBox.height);

    await phase.getByRole('button', { name: 'Collapse child workflow' }).click();
    await expect(nodeNamed(page, 'Collect Evidence')).toHaveCount(0);
  });

  test('on a run, the step opens to the child run it started, with live step statuses', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(ORCHESTRATOR_RUN_URL);
    await page.getByRole('button', { name: 'Diagram' }).first().click();
    const phase = nodeNamed(page, 'Run Readiness Phase').first();
    await expect(phase).toBeVisible({ timeout: 10_000 });

    await phase.getByRole('button', { name: 'Expand child workflow' }).click();

    await expect(nodeNamed(page, 'Collect Evidence').getByTestId('child-step-status')).toHaveAttribute('data-status', 'completed', { timeout: 10_000 });
    await expect(nodeNamed(page, 'Assess Readiness').getByTestId('child-step-status')).toHaveAttribute('data-status', 'running');

    const frame = page.getByTestId('child-workflow-frame');
    await expect(frame.getByRole('link', { name: /Open run/ })).toHaveAttribute(
      'href',
      `/${TEST_ORG_HANDLE}/workflows/Diagram%20Child%20Phase/runs/proc-diagram-child-1`,
    );
  });
});
