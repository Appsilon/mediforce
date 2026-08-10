import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { allowPageErrors, trackPageErrors } from '../helpers/page-errors';

const SUPPLY_CHAIN_DEFINITION_URL = `/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/definitions/1`;

/**
 * Serialized Zod issues as they arrive in the ADR-0005 error envelope's
 * `details`. None of them is step-scoped, so the editor reports every field by
 * name instead of collapsing to the "check the highlighted steps" summary.
 */
const REJECTED_SAVE_ISSUES = [
  {
    path: ['name'],
    code: 'too_small',
    origin: 'string',
    minimum: 1,
    message: 'Too small: expected string to have >=1 characters',
  },
  {
    path: ['description'],
    code: 'too_small',
    origin: 'string',
    minimum: 1,
    message: 'Too small: expected string to have >=1 characters',
  },
  {
    path: ['transitions', 0, 'from'],
    code: 'invalid_type',
    expected: 'string',
    message: 'Invalid input: expected string, received number',
  },
  {
    path: ['visibility'],
    code: 'invalid_value',
    values: ['public', 'private'],
    message: 'Invalid option',
  },
];

/** What `handleSaveFailure` builds from the issues above. */
const REJECTED_SAVE_MESSAGE =
  'name is required; description is required; transitions.0.from must be a string; '
  + 'visibility must be one of: public, private.';

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Returns the sticky header panel (the border-b container at the top of the
 * workflow definition and new-workflow pages). Scoped to avoid collisions with
 * app-shell navigation elements (e.g. the "Switch namespace" button).
 */
function pageHeader(page: import('@playwright/test').Page) {
  return page.locator('div.border-b.sticky');
}

/**
 * Returns a step-type toggle button in the Add Step popover's Section 1.
 * 'creation' → "Create new result", 'decision' → "Make a decision".
 */
function stepTypeButton(page: import('@playwright/test').Page, type: 'creation' | 'decision') {
  const label = type === 'creation' ? 'Create new result' : 'Make a decision';
  return page.getByRole('button', { name: label, exact: true });
}

/**
 * Returns an executor button in the Add Step popover's "Executor" section.
 * 'agent' maps to "Autonomous agent" (L4).
 */
function executorButton(page: import('@playwright/test').Page, executor: 'human' | 'agent' | 'script' | 'cowork') {
  const labels = { human: 'Human', agent: 'Autonomous agent', script: 'Script', cowork: 'Cowork' } as const;
  return page.getByRole('button', { name: labels[executor], exact: true });
}

/**
 * Assert the source-code CodeMirror editor contains `text`, scrolling it down
 * as needed. CodeMirror virtualizes: only on-screen lines are in the DOM, so a
 * step near the bottom of a long document isn't matchable until scrolled into
 * view. Retries scroll-then-check until the text renders.
 */
async function expectJsonEditorContains(page: import('@playwright/test').Page, text: string) {
  // The editor's `.cm-scroller` is `overflow: visible`, so the surrounding modal
  // body (an `overflow-y-auto` div wrapping `.cm-editor`) is what actually
  // scrolls and drives CodeMirror's line virtualization.
  const scroller = page.locator('div.overflow-y-auto').filter({ has: page.locator('.cm-editor') });
  const content = page.locator('.cm-content');
  await expect(async () => {
    await scroller.evaluate((el) => { el.scrollTop += 400; });
    await expect(content).toContainText(text, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe('Workflow Editor Journey', () => {
  // ── Browse ─────────────────────────────────────────────────────────────────

  test('workflow detail shows tabs, definitions, and diagram', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review`);

    // Runs and Definitions tabs visible
    await expect(page.getByRole('tab', { name: /runs/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: /definitions/i })).toBeVisible();

    // Runs tab is default
    const runsTab = page.getByRole('tab', { name: /runs/i });
    await expect(runsTab).toBeVisible({ timeout: 10_000 });
    await expect(runsTab).toHaveAttribute('data-state', 'active');

    // Configurations tab does NOT exist
    await expect(page.getByRole('tab', { name: /configurations/i })).not.toBeVisible();

    // Click Definitions tab — shows definition links or an empty state
    await page.getByRole('tab', { name: /definitions/i }).click();
    await expect(
      page.locator('a[href*="/definitions/"]').or(page.locator('text=/No definitions|Create first/i')).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('workflow Runs tab scopes filters and keeps cost sorting global while loading more', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review`);

    const runsTab = page.getByRole('tab', { name: /runs/i });
    await expect(runsTab).toBeVisible({ timeout: 15_000 });
    await expect(runsTab).toHaveAttribute('data-state', 'active');
    await page.getByRole('button', { name: 'Dry Runs' }).click();

    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(20, { timeout: 10_000 });

    await page.getByRole('button', { name: /^Cost/ }).click();
    await expect(rows.first()).toHaveAttribute('data-run-id', 'proc-workflow-runs-pagination-21');

    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(rows).toHaveCount(21);
    await expect(rows.last()).toHaveAttribute('data-run-id', 'proc-workflow-runs-pagination-1');
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  });

  // ── Definition version page ────────────────────────────────────────────────

  test('definition version shows always-edit canvas with header controls', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    const header = pageHeader(page);

    // Workflow name is shown as a heading (read-only)
    const workflowHeading = header.locator('h1');
    await expect(workflowHeading).toBeVisible({ timeout: 10_000 });
    await expect(workflowHeading).toHaveText('Supply Chain Review');

    // Description field is editable
    const descriptionInput = header.getByPlaceholder('Add a description…');
    await expect(descriptionInput).toBeVisible();
    await expect(descriptionInput).toBeEnabled();

    // Static version label — shows current version number
    await expect(header.getByText(/you are editing workflow version/i)).toBeVisible();
    await expect(header.getByText(/v1/)).toBeVisible();

    // Save button is always enabled — clicking it opens the version-name dialog.
    // (The header exposes a plain "Save"; "Save new version" is the dialog's
    // confirm label.)
    const saveButton = page.getByRole('button', { name: 'Save', exact: true });
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeEnabled();

    // Clicking Save opens the dialog
    await saveButton.click();
    await expect(page.getByRole('heading', { name: /name this version/i })).toBeVisible({ timeout: 3_000 });

    // Cancel closes the dialog without saving
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.getByRole('heading', { name: /name this version/i })).not.toBeVisible();

    // Canvas is always in edit mode — diagram nodes are visible
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 8_000 });

    // Clicking a node opens "Edit step" panel
    await page.locator('.react-flow__node').first().click();
    await expect(page.locator('[data-testid="step-editor"]')).toBeVisible({ timeout: 5_000 });

    // No legacy "Edit" button
    await expect(page.getByRole('button', { name: /^edit$/i })).not.toBeVisible();
  });

  // ── Add Step ──────────────────────────────────────────────────────────────

  test('add step dropdown shows correct type labels and inserts before terminal', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    // Open Add Step popover via the "+" button on an edge
    await page.getByLabel('Add step here').first().click();
    // Both sections visible simultaneously — wait for the executor section header
    await expect(page.getByText('Executor', { exact: true })).toBeVisible({ timeout: 3_000 });

    // Section 1: step type toggles (Creation active by default, Decision available)
    await expect(stepTypeButton(page, 'creation')).toBeVisible();
    await expect(stepTypeButton(page, 'decision')).toBeVisible();

    // Section 2: executor buttons all visible simultaneously
    await expect(executorButton(page, 'human')).toBeVisible();
    await expect(executorButton(page, 'agent')).toBeVisible();
    await expect(executorButton(page, 'script')).toBeVisible();

    // Choose human executor — step is added to the diagram
    await executorButton(page, 'human').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 5_000 });
  });

  test('new step names finalize collision-safe ids after typing', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    await page.getByLabel('Add step here').first().click();
    await expect(page.getByText('Executor', { exact: true })).toBeVisible({ timeout: 3_000 });
    await executorButton(page, 'human').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 5_000 });

    const newStepNode = page.locator('.react-flow__node').filter({ hasText: /New Step/i });
    await newStepNode.click();

    const stepEditor = page.locator('[data-testid="step-editor"]');
    const nameInput = stepEditor.locator('input').first();
    await nameInput.fill('Human Review');
    await nameInput.blur();

    await expect(nameInput).toHaveValue('Human Review');
    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
    await page.getByRole('button', { name: /workflow source code/i }).click();
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 });
    await expectJsonEditorContains(page, '"id": "human-review-2"');
    await expectJsonEditorContains(page, '"id": "human-review"');
    await expectJsonEditorContains(page, '"to": "human-review-2"');
    await expectJsonEditorContains(page, '"from": "human-review-2"');
    await expectJsonEditorContains(page, '"to": "narrative-summary"');
  });

  // ── Undo ─────────────────────────────────────────────────────────────────

  test('undo reverses last canvas change', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    // Undo starts disabled (empty history)
    const undoButton = page.getByRole('button', { name: /undo/i });
    await expect(undoButton).toBeDisabled();

    // Add a step via edge "+" button
    await page.getByLabel('Add step here').first().click();
    await expect(page.getByText('Executor', { exact: true })).toBeVisible({ timeout: 3_000 });
    await executorButton(page, 'human').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 5_000 });

    // Undo is now enabled
    await expect(undoButton).toBeEnabled();

    // Click undo — step is removed
    await undoButton.click();
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount, { timeout: 5_000 });

    // Undo disabled again (stack is now empty)
    await expect(undoButton).toBeDisabled();
  });

  // ── Redo ─────────────────────────────────────────────────────────────────

  test('redo re-applies a step after undo', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    const undoButton = page.getByRole('button', { name: /undo/i });
    const redoButton = page.getByRole('button', { name: /redo/i });

    // Redo starts disabled (empty redo history)
    await expect(redoButton).toBeDisabled();

    // Add a step via edge "+" button
    await page.getByLabel('Add step here').first().click();
    await expect(page.getByText('Executor', { exact: true })).toBeVisible({ timeout: 3_000 });
    await executorButton(page, 'human').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 5_000 });

    // Undo the step addition
    await undoButton.click();
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount, { timeout: 5_000 });

    // Redo is now enabled
    await expect(redoButton).toBeEnabled();

    // Redo — step is re-added
    await redoButton.click();
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 5_000 });
  });

  // ── Hover panel ───────────────────────────────────────────────────────────

  test('step hover panel exposes delete and move actions', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    // The seeded workflow has vendor-assessment → narrative-summary → risk-scoring → human-review → done
    // Hover over the second node (narrative-summary) — it is in the middle so both move buttons are enabled
    const targetNode = page.locator('.react-flow__node').nth(1);
    await targetNode.hover();

    // Delete and move buttons become visible on hover
    const deleteButton = page.getByRole('button', { name: 'Delete step' });
    const moveUpButton = page.getByRole('button', { name: 'Move step up' });
    const moveDownButton = page.getByRole('button', { name: 'Move step down' });
    await expect(deleteButton).toBeVisible({ timeout: 3_000 });
    await expect(moveUpButton).toBeVisible();
    await expect(moveDownButton).toBeVisible();

    // Clicking delete removes the step
    await deleteButton.click();
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount - 1, { timeout: 5_000 });
  });

  // ── Source code modal ─────────────────────────────────────────────────────

  test('workflow source code modal shows live json preview', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    // Open the source-code modal from the toolbar
    await page.getByRole('button', { name: /workflow source code/i }).click();

    // Modal shows the CodeMirror editor
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 });

    // JSON content contains the entry step id. (CodeMirror virtualizes: only
    // on-screen lines are in the DOM, so assert the top-of-document step, not
    // one further down like human-review.)
    const jsonContent = page.locator('.cm-content');
    await expect(jsonContent).toContainText('vendor-assessment', { timeout: 5_000 });

    // Apply button is available inside the modal
    await expect(page.getByRole('button', { name: /apply json/i })).toBeVisible();
  });

  // ── Source editor is modal-gated (not an always-open panel) ───────────────

  test('source code editor is hidden until the modal is opened', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    // No always-open editor: the CodeMirror editor is not shown by default
    await expect(page.locator('.cm-editor')).not.toBeVisible();

    // It appears only after opening the source-code modal
    await page.getByRole('button', { name: /workflow source code/i }).click();
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /apply json/i })).toBeVisible();
  });

  // ── Unapplied JSON edits are never silently discarded ──────────────────────

  test('editing JSON without applying warns and confirms before the modal discards it', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /workflow source code/i }).click();
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 });

    // No warning before any edit
    await expect(page.getByText(/unapplied changes/i)).not.toBeVisible();

    // Edit the JSON without clicking Apply
    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' ');

    // A prominent warning appears
    await expect(page.getByText(/unapplied changes/i)).toBeVisible({ timeout: 5_000 });

    // Trying to close via the X button prompts a confirm; dismissing it keeps
    // the modal open with the edit intact.
    let dialogSeen = false;
    page.once('dialog', async (dialog) => {
      dialogSeen = true;
      expect(dialog.type()).toBe('confirm');
      await dialog.dismiss();
    });
    await page.getByRole('button', { name: 'Close' }).click();
    await expect.poll(() => dialogSeen).toBe(true);
    await expect(page.locator('.cm-editor')).toBeVisible();
    await expect(page.getByText(/unapplied changes/i)).toBeVisible();

    // Accepting the confirm on a second close attempt discards the edit and
    // closes the modal.
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('.cm-editor')).not.toBeVisible();

    // Reopening shows the unedited (re-synced) source — the edit is gone, as
    // the user confirmed.
    await page.getByRole('button', { name: /workflow source code/i }).click();
    await expect(page.getByText(/unapplied changes/i)).not.toBeVisible();

    // Clicking Apply after an edit clears the warning without needing a close.
    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' ');
    await expect(page.getByText(/unapplied changes/i)).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /apply json/i }).click();
    await expect(page.getByText(/unapplied changes/i)).not.toBeVisible();
  });

  // ── Create new workflow ───────────────────────────────────────────────────

  test('create new workflow fills form and publishes', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/new`);

    // Template canvas already has three steps: draft, ai-review, done
    await expect(page.locator('.react-flow__node')).toHaveCount(3, { timeout: 8_000 });

    // Save button starts disabled (all required fields empty). The header shows
    // a plain "Save"; "Publish workflow" is the dialog's confirm label.
    const saveButton = page.getByRole('button', { name: 'Save', exact: true });
    await expect(saveButton).toBeDisabled();

    // Fill Workflow name
    await page.getByPlaceholder('Add a Workflow Name…').fill('e2e-test-workflow');

    // Still disabled — description missing
    await expect(saveButton).toBeDisabled();

    // Fill Description
    await page.getByPlaceholder('Add a workflow description…').fill('End-to-end test workflow created by Playwright');

    // Name + description filled → save enabled
    await expect(saveButton).toBeEnabled();

    // Clicking Save opens the version-name dialog
    await saveButton.click();
    await expect(page.getByRole('heading', { name: /name this version/i })).toBeVisible({ timeout: 5_000 });

    // Fill version title in dialog — live preview updates
    await page.getByPlaceholder(/e\.g\. Added AI review step/i).fill('v1 — initial');
    await expect(page.getByText(/will be saved as/i)).toBeVisible();

    // Confirm in dialog → redirect to the workflow's Runs section (the workflow
    // detail page). "Publish workflow" is the dialog's confirm label (the header
    // button is "Save").
    await page.getByRole('button', { name: /publish workflow/i }).click();
    await page.waitForURL(/\/workflows\/e2e-test-workflow\/?$/, { timeout: 20_000 });

    // Lands on the workflow detail page with the Runs tab active.
    const runsTab = page.getByRole('tab', { name: /runs/i });
    await expect(runsTab).toBeVisible({ timeout: 10_000 });
    await expect(runsTab).toHaveAttribute('data-state', 'active');
  });

  // ── Validation gates ─────────────────────────────────────────────────────

  test('new workflow save blocked when workflow name slugifies to empty', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/new`);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    const saveButton = page.getByRole('button', { name: 'Save', exact: true });

    // Workflow name that slugifies to empty (only special chars → '')
    await page.getByPlaceholder('Add a Workflow Name…').fill('---');

    // Fill description — button still disabled because name slugifies to empty
    await page.getByPlaceholder('Add a workflow description…').fill('Some description');

    // Button must remain disabled — toWorkflowId('---') === ''
    await expect(saveButton).toBeDisabled();
  });

  // ── Save failure message ─────────────────────────────────────────────────

  test('rejected save renders the whole error message unclipped in a toast', async ({ page }) => {
    trackPageErrors(page);
    // The refused save is the point of this test: the browser logs the 400 and
    // the editor logs the rejection it is about to render. Any other console
    // error (React violation, unhandled exception) still fails the test.
    allowPageErrors(page, [
      /^Failed to load resource: the server responded with a status of 400 \(Bad Request\)/,
      /^Workflow save failed/,
    ]);

    // Reject the registration with the ADR-0005 typed envelope so the editor
    // receives the structured issues it builds the header message from.
    await page.route(
      (url) => url.pathname === '/api/workflow-definitions',
      async (route) => {
        if (route.request().method() !== 'POST') {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'validation',
              message: 'Invalid workflow definition',
              details: REJECTED_SAVE_ISSUES,
            },
          }),
        });
      },
    );

    await page.goto(`/${TEST_ORG_HANDLE}/workflows/new`);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    // Drive the real save path: fill the form, confirm the version dialog.
    await page.getByPlaceholder('Add a Workflow Name…').fill('e2e-rejected-workflow');
    await page.getByPlaceholder('Add a workflow description…').fill('Save is rejected by the server on purpose');

    const saveButton = page.getByRole('button', { name: 'Save', exact: true });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(page.getByRole('heading', { name: /name this version/i })).toBeVisible({ timeout: 5_000 });
    await page.getByPlaceholder(/e\.g\. Added AI review step/i).fill('v1 — rejected');
    await page.getByRole('button', { name: /publish workflow/i }).click();

    // The failure toast reports every rejected field, in full.
    const toast = page.getByTestId('toast');
    await expect(toast).toBeVisible({ timeout: 10_000 });
    const errorMessage = toast.getByText(REJECTED_SAVE_MESSAGE);
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toHaveText(REJECTED_SAVE_MESSAGE);

    // …and it is rendered, not clipped. `truncate` (the bug) would cut the
    // message to one ellipsised line, so assert the element wraps instead:
    // no truncate class, nothing overflowing its box in either axis, and a box
    // taller than a single line — this message cannot fit on one.
    const box = await errorMessage.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      lineHeight: parseFloat(getComputedStyle(element).lineHeight),
    }));
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
    expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight + 1);
    expect(box.clientHeight).toBeGreaterThan(box.lineHeight * 1.5);
    await expect(errorMessage).not.toHaveClass(/truncate/);
  });

  // ── Pane click deselects step ─────────────────────────────────────────────

  test('clicking canvas pane deselects the selected step', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    // Click a node — step editor opens
    await page.locator('.react-flow__node').first().click();
    await expect(page.locator('[data-testid="step-editor"]')).toBeVisible({ timeout: 5_000 });

    // Click empty canvas space — pane click deselects, step editor closes
    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('[data-testid="step-editor"]')).not.toBeVisible({ timeout: 5_000 });
  });

  // ── Executor switching clears stale JSON fields ───────────────────────────

  test('executor chosen at creation is locked in the editor and reflected in wd.json', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    // Add an agent step via edge "+" button
    await page.getByLabel('Add step here').first().click();
    await expect(page.getByText('Executor', { exact: true })).toBeVisible({ timeout: 3_000 });
    await executorButton(page, 'agent').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 5_000 });

    // Click the new step node — step editor opens showing the icon header
    await page.locator('.react-flow__node').filter({ hasText: /New Step/i }).click();
    const stepEditor = page.locator('[data-testid="step-editor"]');
    await expect(stepEditor).toBeVisible({ timeout: 5_000 });

    // Executor is shown as a read-only locked field (no toggle buttons)
    await expect(stepEditor.getByText('executor')).toBeVisible();
    await expect(stepEditor.getByTitle(/executor is set at creation/i)).toBeVisible();
    // The locked executor field shows the Agent label (scoped to the executor
    // row — "Agent" also appears in the step-editor metadata row).
    await expect(
      stepEditor.getByTitle(/executor is set at creation/i).getByText('Agent', { exact: true }),
    ).toBeVisible();

    // Deselect, then open the source modal to verify wd.json reflects the agent executor
    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
    await page.getByRole('button', { name: /workflow source code/i }).click();
    const jsonContent = page.locator('.cm-content');
    await expect(jsonContent).toBeVisible({ timeout: 10_000 });
    // The new agent step is further down the document than the on-screen lines;
    // scroll the editor until its executor/plugin render.
    await expectJsonEditorContains(page, '"executor": "agent"');
    await expectJsonEditorContains(page, 'opencode-agent');
  });

  // ── Cowork step ───────────────────────────────────────────────────────────

  test('cowork step appears in diagram and editor shows configuration', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    // Add a cowork step via edge "+" button
    await page.getByLabel('Add step here').first().click();
    await expect(page.getByText('Executor', { exact: true })).toBeVisible({ timeout: 3_000 });
    await executorButton(page, 'cowork').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 5_000 });

    // New node shows "Cowork" executor label in the diagram
    await expect(page.locator('.react-flow__node').getByText('Cowork').first()).toBeVisible({ timeout: 3_000 });

    // Click the new step to open the step editor
    await page.locator('.react-flow__node').filter({ hasText: /New Step/i }).click();
    // The editor is a single-open accordion; cowork config lives in the
    // "Collaboration" card, collapsed by default — open it first.
    await page.locator('[data-testid="step-editor"]').getByRole('button', { name: 'Collaboration' }).click();
    // Step editor opens with the cowork explainer for a new step
    await expect(page.getByText(/What is a Cowork step/i)).toBeVisible({ timeout: 3_000 });

    // Chat / Voice toggle is visible, Chat is active by default
    await expect(page.getByRole('button', { name: /^Chat$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Voice$/i })).toBeVisible();

    // System prompt textarea is visible and fillable
    const systemPromptTextarea = page.getByPlaceholder(/Instructions for the AI collaborator/i);
    await expect(systemPromptTextarea).toBeVisible();
    await systemPromptTextarea.fill('You are a helpful clinical trial data analyst.');
    // Verify the value was accepted
    await expect(systemPromptTextarea).toHaveValue('You are a helpful clinical trial data analyst.');

    // Deselect, then open the source modal to verify the cowork executor
    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
    await page.getByRole('button', { name: /workflow source code/i }).click();
    const jsonContent = page.locator('.cm-content');
    await expect(jsonContent).toBeVisible({ timeout: 10_000 });
    // Scroll the editor until the new cowork step's executor renders (CodeMirror
    // virtualizes off-screen lines).
    await expectJsonEditorContains(page, '"executor": "cowork"');
  });

  test('cowork step MCP server editor supports add, fill, transport toggle, and remove', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    // Add a cowork step
    await page.getByLabel('Add step here').first().click();
    await expect(page.getByText('Executor', { exact: true })).toBeVisible({ timeout: 3_000 });
    await executorButton(page, 'cowork').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 5_000 });

    // Open the new step editor
    await page.locator('.react-flow__node').filter({ hasText: /New Step/i }).click();
    // Cowork config (incl. the MCP server editor) is in the collapsed
    // "Collaboration" card — open it first.
    await page.locator('[data-testid="step-editor"]').getByRole('button', { name: 'Collaboration' }).click();
    await expect(page.getByText(/What is a Cowork step/i)).toBeVisible({ timeout: 3_000 });

    // Scope MCP edits to the step editor side panel.
    const sidePanel = page.locator('[data-testid="step-editor"]');

    // Empty-state hint is visible before adding any server.
    await expect(sidePanel.getByText(/No MCP servers configured/i)).toBeVisible();
    await expect(sidePanel.getByText('MCP Servers', { exact: true })).toBeVisible();

    // Click Add — a server entry with name/command inputs appears.
    await sidePanel.getByRole('button', { name: /^Add$/ }).click();
    await expect(sidePanel.getByText(/No MCP servers configured/i)).not.toBeVisible();

    // Fill the stdio-mode server fields.
    const nameInput = sidePanel.getByPlaceholder('server-name');
    await expect(nameInput).toBeVisible({ timeout: 3_000 });
    await nameInput.fill('tealflow');
    await expect(nameInput).toHaveValue('tealflow');

    const commandInput = sidePanel.getByPlaceholder(/e\.g\. tealflow-mcp/);
    await expect(commandInput).toBeVisible();
    await commandInput.fill('tealflow-mcp');
    await expect(commandInput).toHaveValue('tealflow-mcp');

    // Transport toggle switches the visible input to URL mode and back.
    const transportToggle = sidePanel.getByRole('button', { name: /^stdio$/i });
    await transportToggle.click();
    await expect(sidePanel.getByPlaceholder(/localhost:8080\/mcp/)).toBeVisible();
    await expect(sidePanel.getByPlaceholder(/e\.g\. tealflow-mcp/)).not.toBeVisible();

    await sidePanel.getByRole('button', { name: /^http$/i }).click();
    await expect(sidePanel.getByPlaceholder(/e\.g\. tealflow-mcp/)).toBeVisible();

    // Remove — empty state returns.
    await sidePanel.locator('button').filter({ has: page.locator('svg.lucide-trash-2') }).click();
    await expect(sidePanel.getByText(/No MCP servers configured/i)).toBeVisible();
  });

  // ── Save & Start Run resolver flow ─────────────────────────────────────────

  test('Save & Start Run opens the version dialog and cancel aborts without starting', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    // The header exposes both a plain "Save" and a "Save & Start Run" button.
    const saveAndStart = page.getByRole('button', { name: /save & start run/i });
    await expect(saveAndStart).toBeEnabled({ timeout: 10_000 });

    // Clicking it runs onBeforeStart, which parks a resolver and opens the
    // version-name dialog (the resolver-ref coordination this branch adds).
    await saveAndStart.click();
    await expect(page.getByRole('heading', { name: /name this version/i })).toBeVisible({ timeout: 5_000 });

    // Cancelling resolves the parked start with `undefined`: the dialog closes,
    // no run is started, we stay on the definition page, and the button is idle
    // again (not stuck in the "Saving…" pending state).
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.getByRole('heading', { name: /name this version/i })).not.toBeVisible();
    await expect(page).toHaveURL(/\/definitions\/1$/);
    await expect(page.getByRole('button', { name: /save & start run/i })).toBeEnabled();
  });

  // ── Save & Dry Run resolver flow ───────────────────────────────────────────

  test('Save & Dry Run sits beside Save & Start Run and opens the version dialog', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    // The header now exposes a dedicated "Save & Dry Run" button next to
    // "Save & Start Run" — the mode is fixed by the button, not chosen in a dialog.
    const saveAndDryRun = page.getByRole('button', { name: /save & dry run/i });
    await expect(saveAndDryRun).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /save & start run/i })).toBeEnabled();

    // It runs the same save-then-start handshake: parks a resolver and opens the
    // version-name dialog. Cancelling aborts without starting a run.
    await saveAndDryRun.click();
    await expect(page.getByRole('heading', { name: /name this version/i })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.getByRole('heading', { name: /name this version/i })).not.toBeVisible();
    await expect(page).toHaveURL(/\/definitions\/1$/);
    await expect(saveAndDryRun).toBeEnabled();
  });

  // ── Unsaved-changes guard ──────────────────────────────────────────────────

  test('leaving an edited workflow asks before discarding the changes', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    await pageHeader(page).getByPlaceholder('Add a description…').fill('Edited but never saved');

    // The breadcrumb back to the workflows list is the route reported in #1027.
    const breadcrumb = page.locator('header nav').getByRole('link', { name: 'Workflows' });
    await breadcrumb.click();

    const prompt = page.getByText('You have unsaved changes. Are you sure you want to leave?');
    await expect(prompt).toBeVisible({ timeout: 5_000 });
    await expect(page).toHaveURL(/\/definitions\/1$/);

    // Declining keeps both the page and the edit.
    await page.getByRole('button', { name: /stay on this page/i }).click();
    await expect(prompt).not.toBeVisible();
    await expect(page).toHaveURL(/\/definitions\/1$/);
    await expect(pageHeader(page).getByPlaceholder('Add a description…')).toHaveValue('Edited but never saved');

    // Confirming discards them and completes the navigation that was held.
    await breadcrumb.click();
    await page.getByRole('button', { name: /leave without saving/i }).click();
    await expect(page).not.toHaveURL(/\/definitions\/1$/, { timeout: 10_000 });
  });

  test('leaving an untouched workflow navigates without a prompt', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    await page.locator('header nav').getByRole('link', { name: 'Workflows' }).click();

    await expect(page).not.toHaveURL(/\/definitions\/1$/, { timeout: 10_000 });
    await expect(page.getByText('You have unsaved changes. Are you sure you want to leave?')).not.toBeVisible();
  });
});
