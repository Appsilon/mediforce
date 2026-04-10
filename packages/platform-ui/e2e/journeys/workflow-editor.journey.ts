import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

const SUPPLY_CHAIN_DEFINITION_URL = `/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/definitions/1`;

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
 * Returns a locator for the step-type button inside the Add Step dropdown.
 * Scopes by the button's unique description paragraph to avoid false matches.
 */
const STEP_TYPE_DESCRIPTIONS = {
  Input: 'A step where content or data is produced — by a human, an AI agent, or a script.',
  Review: 'A step where someone evaluates work and gives a verdict such as approve or reject.',
  Decision: 'A branching step that routes the workflow to different paths based on a condition.',
  End: 'Marks the final state of the workflow — all paths must lead here.',
} as const;

function stepTypeButton(page: import('@playwright/test').Page, type: keyof typeof STEP_TYPE_DESCRIPTIONS) {
  return page.locator('button').filter({
    has: page.locator('p').filter({ hasText: STEP_TYPE_DESCRIPTIONS[type] }),
  });
}

/**
 * Returns the executor button inside the Add Step dropdown.
 * Uses strict text matching to avoid matching step descriptions that contain "human".
 */
function executorButton(page: import('@playwright/test').Page, executor: 'human' | 'agent' | 'script' | 'cowork') {
  // Executor buttons have exactly the executor name as their full text content.
  return page.locator('button').filter({ hasText: new RegExp(`^${executor}$`, 'i') });
}

/**
 * Returns the executor toggle button inside the step editor side panel.
 * Scoped to the side panel to avoid matching the Add Step dropdown buttons.
 */
function stepEditorExecutorButton(page: import('@playwright/test').Page, executor: 'human' | 'agent' | 'script' | 'cowork') {
  // The side panel is the right half of the canvas layout (border-l container).
  return page.locator('div.border-l button').filter({ hasText: new RegExp(`^${executor}$`, 'i') });
}

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe('Workflow Editor Journey', () => {
  // ── Browse ─────────────────────────────────────────────────────────────────

  test('workflow detail shows tabs, definitions, and diagram', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-editor-browse', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review`);

    // Runs and Definitions tabs visible
    await expect(page.getByRole('tab', { name: /runs/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: /definitions/i })).toBeVisible();

    // Runs tab is default
    await expect(page.getByRole('tab', { name: /runs/i })).toHaveAttribute('data-state', 'active');
    await showStep(page);

    // Configurations tab does NOT exist
    await expect(page.getByRole('tab', { name: /configurations/i })).not.toBeVisible();

    // Click Definitions tab — shows definition links or an empty state
    await click(page, page.getByRole('tab', { name: /definitions/i }));
    await expect(
      page.locator('a[href*="/definitions/"]').or(page.locator('text=/No definitions|Create first/i')).first(),
    ).toBeVisible({ timeout: 10_000 });
    await showResult(page);
    await endRecording(page);
  });

  // ── Definition version page ────────────────────────────────────────────────

  test('definition version shows always-edit canvas with header controls', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-editor-canvas', testInfo);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    const header = pageHeader(page);

    // Namespace input is read-only — its value equals the seeded namespace
    const namespaceInput = header.locator('input[disabled]').first();
    await expect(namespaceInput).toBeVisible({ timeout: 10_000 });
    await expect(namespaceInput).toHaveValue('test');
    await showStep(page);

    // Workflow ID input is read-only — contains the workflow name
    const workflowIdInput = header.locator('input[disabled]').nth(1);
    await expect(workflowIdInput).toBeVisible();
    await expect(workflowIdInput).toHaveValue('Supply Chain Review');

    // Description field is editable
    const descriptionInput = header.getByPlaceholder('What does this workflow do?');
    await expect(descriptionInput).toBeVisible();
    await expect(descriptionInput).toBeEnabled();

    // Version name field is editable — save button disabled while empty
    const versionNameInput = header.getByPlaceholder(/e.g. Added automated review step/i);
    await expect(versionNameInput).toBeVisible();
    const saveButton = page.getByRole('button', { name: /save new version/i });
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeDisabled();
    await showStep(page);

    // Typing a version name enables save
    await versionNameInput.fill('Added risk scoring step');
    await expect(saveButton).toBeEnabled();

    // Clearing it disables save again
    await versionNameInput.fill('');
    await expect(saveButton).toBeDisabled();
    await showStep(page);

    // Canvas is always in edit mode — diagram nodes are visible
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 8_000 });

    // Clicking a node opens "Edit step" panel
    await click(page, page.locator('.react-flow__node').first());
    await expect(page.getByRole('heading', { name: /edit step/i })).toBeVisible({ timeout: 5_000 });
    await showResult(page);

    // No legacy "Edit" button or "editing" badge
    await expect(page.getByRole('button', { name: /^edit$/i })).not.toBeVisible();
    await expect(page.locator('text=editing')).not.toBeVisible();

    await endRecording(page);
  });

  // ── Add Step ──────────────────────────────────────────────────────────────

  test('add step dropdown shows correct type labels and inserts before terminal', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-editor-add-step', testInfo);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    // Open Add Step dropdown
    await click(page, page.getByRole('button', { name: /\+ add step/i }));
    // Wait for dropdown to appear
    await expect(page.getByText(/^step type$/i)).toBeVisible({ timeout: 3_000 });
    await showStep(page);

    // Step type labels match the new naming (Input not Creation, End not Terminal)
    await expect(stepTypeButton(page, 'Input')).toBeVisible();
    await expect(stepTypeButton(page, 'Review')).toBeVisible();
    await expect(stepTypeButton(page, 'Decision')).toBeVisible();
    await expect(stepTypeButton(page, 'End')).toBeVisible();

    // "End" is disabled — a terminal step already exists in the seeded definition
    await expect(stepTypeButton(page, 'End')).toBeDisabled();

    // Each option shows a description
    await expect(page.getByText(/A step where content or data is produced/i)).toBeVisible();
    await expect(page.getByText(/A step where someone evaluates work/i)).toBeVisible();
    await showStep(page);

    // Select "Input" type → executor options appear
    await click(page, stepTypeButton(page, 'Input'));
    await expect(page.getByText(/^executor$/i)).toBeVisible({ timeout: 3_000 });

    // Executor buttons for creation type: human, agent, script
    await expect(executorButton(page, 'human')).toBeVisible();
    await expect(executorButton(page, 'agent')).toBeVisible();
    await expect(executorButton(page, 'script')).toBeVisible();
    await showStep(page);

    // Choose human executor — step is added to the diagram
    await click(page, executorButton(page, 'human'));
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 5_000 });
    await showResult(page);

    // New step is auto-selected and its editor opens
    await expect(page.getByRole('heading', { name: /edit step/i })).toBeVisible();

    // Selected label in toolbar confirms it is NOT the terminal "done" step
    const selectedLabel = page.locator('span').filter({ hasText: /^Selected:/ });
    await expect(selectedLabel).toBeVisible();
    const labelText = await selectedLabel.textContent();
    expect(labelText).not.toContain('done');

    await endRecording(page);
  });

  // ── Undo ─────────────────────────────────────────────────────────────────

  test('undo reverses last canvas change', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-editor-undo', testInfo);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    // Undo starts disabled (empty history)
    const undoButton = page.getByRole('button', { name: /↩ undo/i });
    await expect(undoButton).toBeDisabled();

    // Add a step
    await click(page, page.getByRole('button', { name: /\+ add step/i }));
    await expect(page.getByText(/^step type$/i)).toBeVisible({ timeout: 3_000 });
    await click(page, stepTypeButton(page, 'Input'));
    await expect(page.getByText(/^executor$/i)).toBeVisible({ timeout: 3_000 });
    await click(page, executorButton(page, 'human'));
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 5_000 });
    await showStep(page);

    // Undo is now enabled
    await expect(undoButton).toBeEnabled();

    // Click undo — step is removed
    await click(page, undoButton);
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount, { timeout: 5_000 });
    await showResult(page);

    // Undo disabled again (stack is now empty)
    await expect(undoButton).toBeDisabled();

    await endRecording(page);
  });

  // ── YAML panel ───────────────────────────────────────────────────────────

  test('yaml panel shows live preview and supports yaml edit mode', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-editor-yaml', testInfo);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    // Right panel shows YAML when no step is selected
    await expect(page.getByRole('heading', { name: 'YAML' })).toBeVisible({ timeout: 10_000 });

    // YAML preview contains step IDs from the seeded definition
    const yamlPre = page.locator('pre');
    await expect(yamlPre).toBeVisible({ timeout: 5_000 });
    const yamlText = await yamlPre.textContent();
    expect(yamlText).toContain('vendor-assessment');
    expect(yamlText).toContain('human-review');
    await showStep(page);

    // "Edit YAML" button switches the right panel to a textarea
    await click(page, page.getByRole('button', { name: /edit yaml/i }));
    // The YAML editor textarea is inside the right side panel (not the header inputs)
    const yamlTextarea = page.locator('div.overflow-y-auto textarea');
    await expect(yamlTextarea).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole('button', { name: /apply yaml/i })).toBeVisible();

    // Cancel exits YAML edit mode and restores the preview
    await click(page, page.getByRole('button', { name: /^cancel$/i }));
    await expect(yamlPre).toBeVisible({ timeout: 3_000 });
    await showResult(page);

    await endRecording(page);
  });

  // ── Create new workflow ───────────────────────────────────────────────────

  test('create new workflow fills form and publishes', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-new', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/new`);

    // Instructional copy is visible
    await expect(page.getByText(/Design your workflow visually/i)).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Template canvas already has three steps: draft, ai-review, done
    await expect(page.locator('.react-flow__node')).toHaveCount(3, { timeout: 8_000 });
    const templateNodeCount = await page.locator('.react-flow__node').count();

    // Save button starts disabled (all required fields empty)
    const saveButton = page.getByRole('button', { name: /save and publish workflow/i });
    await expect(saveButton).toBeDisabled();

    // Fill Workflow ID
    await page.getByPlaceholder(/clinical-trial-review/i).fill('e2e-test-workflow');

    // Still disabled — description and version name missing
    await expect(saveButton).toBeDisabled();

    // Fill Description (use placeholder — label has no htmlFor)
    await page.getByPlaceholder('What does this workflow do?').fill('End-to-end test workflow created by Playwright');

    // Still disabled — version name missing
    await expect(saveButton).toBeDisabled();
    await showStep(page);

    // Fill Version name (use placeholder — label has no htmlFor)
    await page.getByPlaceholder(/Initial version/i).fill('v1 — initial');

    // All fields filled → save enabled
    await expect(saveButton).toBeEnabled();
    await showStep(page);

    // Save → redirect to the new definition page
    await click(page, saveButton);
    // Wait for the redirect — skips the brief Publishing/Created intermediate state
    // (which is ambiguous with YAML preview text containing "created by Playwright")
    await page.waitForURL(/\/workflows\/e2e-test-workflow\/definitions\/\d+/, { timeout: 20_000 });

    // On the definition page the Workflow ID input shows the new workflow name
    const header = pageHeader(page);
    await expect(header.locator('input[disabled]').nth(1)).toBeVisible({ timeout: 10_000 });
    await expect(header.locator('input[disabled]').nth(1)).toHaveValue('e2e-test-workflow');
    await showResult(page);

    await endRecording(page);
  });

  // ── Validation gates ─────────────────────────────────────────────────────

  test('new workflow save blocked when workflow name slugifies to empty', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-new-validation', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/new`);

    await expect(page.getByText(/Design your workflow visually/i)).toBeVisible({ timeout: 10_000 });

    const saveButton = page.getByRole('button', { name: /save and publish workflow/i });

    // Workflow ID input that slugifies to empty (only special chars → '')
    await page.getByPlaceholder(/clinical-trial-review/i).fill('---');

    // Fill other required fields
    await page.getByPlaceholder('What does this workflow do?').fill('Some description');
    await page.getByPlaceholder(/Initial version/i).fill('v1');

    // Button must remain disabled — toWorkflowId('---') === ''
    await expect(saveButton).toBeDisabled();
    await showResult(page);

    await endRecording(page);
  });

  // ── Pane click deselects step ─────────────────────────────────────────────

  test('clicking canvas pane deselects step and restores YAML panel', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-editor-pane-deselect', testInfo);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    // YAML panel is visible initially (no step selected)
    await expect(page.getByRole('heading', { name: 'YAML' })).toBeVisible({ timeout: 10_000 });

    // Click a node — step editor opens
    await click(page, page.locator('.react-flow__node').first());
    await expect(page.getByRole('heading', { name: /edit step/i })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('heading', { name: 'YAML' })).not.toBeVisible();
    await showStep(page);

    // Click empty canvas space — pane click triggers deselect, YAML panel returns
    // Click near top-left corner to avoid hitting any node
    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
    await expect(page.getByRole('heading', { name: 'YAML' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /edit step/i })).not.toBeVisible();
    await showResult(page);

    await endRecording(page);
  });

  // ── Executor switching clears stale YAML fields ───────────────────────────

  test('switching executor removes stale fields from YAML', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-editor-executor-switch', testInfo);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    // Add an agent step
    await click(page, page.getByRole('button', { name: /\+ add step/i }));
    await expect(page.getByText(/^step type$/i)).toBeVisible({ timeout: 3_000 });
    await click(page, stepTypeButton(page, 'Input'));
    await expect(page.getByText(/^executor$/i)).toBeVisible({ timeout: 3_000 });
    await click(page, executorButton(page, 'agent'));
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 5_000 });

    // The new step is auto-selected — step editor is already open
    await expect(page.getByRole('heading', { name: /edit step/i })).toBeVisible({ timeout: 5_000 });
    await showStep(page);

    // Switch executor to human directly in the open step editor
    // Use .first() — executor toggle human button comes before Review sub-type buttons in DOM
    await click(page, stepEditorExecutorButton(page, 'human').first());
    await showStep(page);

    // Deselect and verify YAML no longer contains agent-specific fields
    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
    const yamlPre = page.locator('pre');
    await expect(yamlPre).toBeVisible({ timeout: 10_000 });
    const yamlWithHuman = await yamlPre.textContent() ?? '';
    // The new step should now be human with no agent-specific fields
    expect(yamlWithHuman).not.toContain('opencode-agent');
    // Extract the new step's section (starts at 'id: new-step-' and ends at the next list item or end)
    const newStepSection = yamlWithHuman.slice(yamlWithHuman.indexOf('id: new-step-'));
    expect(newStepSection).toContain('executor: human');
    // autonomyLevel is preserved when switching executor so it can be restored on return —
    // only strictly agent-specific fields (plugin, opencode-agent config) should be gone
    expect(newStepSection).not.toContain('opencode-agent');
    await showResult(page);

    await endRecording(page);
  });

  // ── Cowork step ───────────────────────────────────────────────────────────

  test('cowork step appears in diagram and editor shows configuration', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-editor-cowork', testInfo);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    // Add a cowork step
    await click(page, page.getByRole('button', { name: /\+ add step/i }));
    await expect(page.getByText(/^step type$/i)).toBeVisible({ timeout: 3_000 });
    await click(page, stepTypeButton(page, 'Input'));
    await expect(page.getByText(/^executor$/i)).toBeVisible({ timeout: 3_000 });
    await click(page, executorButton(page, 'cowork'));
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 5_000 });
    await showStep(page);

    // New node shows "Cowork" executor label in the diagram
    // Search in any canvas node — don't rely on index since insertion order may vary in ReactFlow DOM
    await expect(page.locator('.react-flow__node').getByText('Cowork').first()).toBeVisible({ timeout: 3_000 });

    // Step editor opens with the cowork explainer for a new step
    await expect(page.getByText(/What is a Cowork step/i)).toBeVisible({ timeout: 3_000 });
    await showStep(page);

    // Chat / Voice toggle is visible, Chat is active by default
    await expect(page.getByRole('button', { name: /^Chat$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Voice$/i })).toBeVisible();

    // System prompt textarea is visible
    const systemPromptTextarea = page.getByPlaceholder(/Instructions for the AI collaborator/i);
    await expect(systemPromptTextarea).toBeVisible();
    await systemPromptTextarea.fill('You are a helpful clinical trial data analyst.');
    await showStep(page);

    // Deselect to see YAML — it should contain cowork config
    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
    const yamlPre = page.locator('pre');
    await expect(yamlPre).toBeVisible({ timeout: 10_000 });
    const yamlText = await yamlPre.textContent();
    expect(yamlText).toContain('executor: cowork');
    expect(yamlText).toContain('agent: chat');
    expect(yamlText).toContain('clinical trial data analyst');
    await showResult(page);

    await endRecording(page);
  });
});
