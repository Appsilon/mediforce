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
  Creation: 'A step where content or data is produced — by a human, an AI agent, or a script.',
  Review: 'A step where someone evaluates work and gives a verdict such as approve or reject.',
  Decision: 'A branching step that routes the workflow to different paths based on a condition.',
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

    // Workflow name is shown as a heading (read-only)
    const workflowHeading = header.locator('h1');
    await expect(workflowHeading).toBeVisible({ timeout: 10_000 });
    await expect(workflowHeading).toHaveText('Supply Chain Review');
    await showStep(page);

    // Description field is editable
    const descriptionInput = header.getByPlaceholder('Add a description…');
    await expect(descriptionInput).toBeVisible();
    await expect(descriptionInput).toBeEnabled();

    // Static version label — shows current version number
    await expect(header.getByText(/you are editing workflow version/i)).toBeVisible();
    await expect(header.getByText(/v1/)).toBeVisible();

    // Save button is always enabled — clicking it opens the version-name dialog
    const saveButton = page.getByRole('button', { name: /save new version/i });
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeEnabled();
    await showStep(page);

    // Clicking Save opens the dialog
    await click(page, saveButton);
    await expect(page.getByRole('heading', { name: /name this version/i })).toBeVisible({ timeout: 3_000 });

    // Cancel closes the dialog without saving
    await click(page, page.getByRole('button', { name: /^cancel$/i }));
    await expect(page.getByRole('heading', { name: /name this version/i })).not.toBeVisible();
    await showStep(page);

    // Canvas is always in edit mode — diagram nodes are visible
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 8_000 });

    // Clicking a node opens "Edit step" panel
    await click(page, page.locator('.react-flow__node').first());
    await expect(page.locator('[data-testid="step-editor"]')).toBeVisible({ timeout: 5_000 });
    await showResult(page);

    // No legacy "Edit" button
    await expect(page.getByRole('button', { name: /^edit$/i })).not.toBeVisible();

    await endRecording(page);
  });

  // ── Add Step ──────────────────────────────────────────────────────────────

  test('add step dropdown shows correct type labels and inserts before terminal', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-editor-add-step', testInfo);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    // Open Add Step popover via the "+" button on an edge
    await click(page, page.getByLabel('Add step here').first());
    // Wait for popover to appear
    await expect(page.getByText(/^step type$/i)).toBeVisible({ timeout: 3_000 });
    await showStep(page);

    // Step type labels: Creation, Review, Decision
    await expect(stepTypeButton(page, 'Creation')).toBeVisible();
    await expect(stepTypeButton(page, 'Review')).toBeVisible();
    await expect(stepTypeButton(page, 'Decision')).toBeVisible();

    // Each option shows a description
    await expect(page.getByText(/A step where content or data is produced/i)).toBeVisible();
    await expect(page.getByText(/A step where someone evaluates work/i)).toBeVisible();
    await showStep(page);

    // Select "Creation" type → executor options appear
    await click(page, stepTypeButton(page, 'Creation'));
    await expect(page.getByText(/who handles this step\?/i)).toBeVisible({ timeout: 3_000 });

    // Executor buttons for creation type: human, agent, script, cowork
    await expect(executorButton(page, 'human')).toBeVisible();
    await expect(executorButton(page, 'agent')).toBeVisible();
    await expect(executorButton(page, 'script')).toBeVisible();
    await showStep(page);

    // Choose human executor — step is added to the diagram
    await click(page, executorButton(page, 'human'));
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 5_000 });
    await showResult(page);

    await endRecording(page);
  });

  // ── Undo ─────────────────────────────────────────────────────────────────

  test('undo reverses last canvas change', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-editor-undo', testInfo);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    // Undo starts disabled (empty history)
    const undoButton = page.getByRole('button', { name: /^undo$/i });
    await expect(undoButton).toBeDisabled();

    // Add a step via edge "+" button
    await click(page, page.getByLabel('Add step here').first());
    await expect(page.getByText(/^step type$/i)).toBeVisible({ timeout: 3_000 });
    await click(page, stepTypeButton(page, 'Creation'));
    await expect(page.getByText(/who handles this step\?/i)).toBeVisible({ timeout: 3_000 });
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

  // ── Redo ─────────────────────────────────────────────────────────────────

  test('redo re-applies a step after undo', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-editor-redo', testInfo);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    const undoButton = page.getByRole('button', { name: /^undo$/i });
    const redoButton = page.getByRole('button', { name: /^redo$/i });

    // Redo starts disabled (empty redo history)
    await expect(redoButton).toBeDisabled();

    // Add a step via edge "+" button
    await click(page, page.getByLabel('Add step here').first());
    await expect(page.getByText(/^step type$/i)).toBeVisible({ timeout: 3_000 });
    await click(page, stepTypeButton(page, 'Creation'));
    await expect(page.getByText(/who handles this step\?/i)).toBeVisible({ timeout: 3_000 });
    await click(page, executorButton(page, 'human'));
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 5_000 });
    await showStep(page);

    // Undo the step addition
    await click(page, undoButton);
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount, { timeout: 5_000 });

    // Redo is now enabled
    await expect(redoButton).toBeEnabled();
    await showStep(page);

    // Redo — step is re-added
    await click(page, redoButton);
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 5_000 });
    await showResult(page);

    await endRecording(page);
  });

  // ── Hover panel ───────────────────────────────────────────────────────────

  test('step hover panel exposes delete and move actions', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-editor-hover-panel', testInfo);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    // The seeded workflow has vendor-assessment → narrative-summary → risk-scoring → human-review → done
    // Hover over the second node (narrative-summary) — it is in the middle so both move buttons are enabled
    const targetNode = page.locator('.react-flow__node').nth(1);
    await targetNode.hover();
    await showStep(page);

    // Delete and move buttons become visible on hover
    const deleteButton = page.getByRole('button', { name: 'Delete step' });
    const moveUpButton = page.getByRole('button', { name: 'Move step up' });
    const moveDownButton = page.getByRole('button', { name: 'Move step down' });
    await expect(deleteButton).toBeVisible({ timeout: 3_000 });
    await expect(moveUpButton).toBeVisible();
    await expect(moveDownButton).toBeVisible();
    await showStep(page);

    // Clicking delete removes the step
    await deleteButton.click();
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount - 1, { timeout: 5_000 });
    await showResult(page);

    await endRecording(page);
  });

  // ── YAML panel ───────────────────────────────────────────────────────────

  test('yaml panel shows live preview in code editor', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-editor-yaml', testInfo);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    // Right panel shows CodeMirror editor when no step is selected
    const yamlEditor = page.locator('.cm-editor');
    await expect(yamlEditor).toBeVisible({ timeout: 10_000 });

    // YAML content contains step IDs from the seeded definition
    const yamlContent = page.locator('.cm-content');
    await expect(yamlContent).toBeVisible({ timeout: 5_000 });
    const yamlText = await yamlContent.textContent();
    expect(yamlText).toContain('vendor-assessment');
    expect(yamlText).toContain('human-review');
    await showStep(page);

    // Apply YAML button and source code label are visible in toolbar when no step is selected
    await expect(page.getByRole('button', { name: /apply yaml/i })).toBeVisible();
    await expect(page.getByText('Workflow source code')).toBeVisible();
    await showResult(page);

    await endRecording(page);
  });

  // ── YAML hidden when step selected ───────────────────────────────────────

  test('yaml editor and save button hide when a step is selected', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-editor-yaml-hidden', testInfo);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    // YAML editor visible when no step selected
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /apply yaml/i })).toBeVisible();
    await showStep(page);

    // Select a step — YAML editor and Save YAML button are hidden
    await click(page, page.locator('.react-flow__node').first());
    await expect(page.locator('[data-testid="step-editor"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.cm-editor')).not.toBeVisible();
    await expect(page.getByRole('button', { name: /apply yaml/i })).not.toBeVisible();
    await showResult(page);

    await endRecording(page);
  });

  // ── Create new workflow ───────────────────────────────────────────────────

  test('create new workflow fills form and publishes', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-new', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/new`);

    // Template canvas already has three steps: draft, ai-review, done
    await expect(page.locator('.react-flow__node')).toHaveCount(3, { timeout: 8_000 });

    // Save button starts disabled (all required fields empty)
    const saveButton = page.getByRole('button', { name: /publish workflow/i });
    await expect(saveButton).toBeDisabled();

    // Fill Workflow name
    await page.getByPlaceholder('Workflow name…').fill('e2e-test-workflow');

    // Still disabled — description missing
    await expect(saveButton).toBeDisabled();

    // Fill Description
    await page.getByPlaceholder('Add a description…').fill('End-to-end test workflow created by Playwright');

    // Name + description filled → save enabled
    await expect(saveButton).toBeEnabled();
    await showStep(page);

    // Clicking Save opens the version-name dialog
    await click(page, saveButton);
    await expect(page.getByRole('heading', { name: /name this version/i })).toBeVisible({ timeout: 5_000 });

    // Fill version title in dialog — live preview updates
    await page.getByPlaceholder(/e\.g\. Added AI review step/i).fill('v1 — initial');
    await expect(page.getByText(/will be saved as/i)).toBeVisible();
    await showStep(page);

    // Confirm in dialog → redirect to the new definition page
    // Use .last() because the dialog confirm button is the second "Publish workflow"
    // button in the DOM (the first is the disabled header button behind the overlay).
    await click(page, page.getByRole('button', { name: /publish workflow/i }).last());
    await page.waitForURL(/\/workflows\/e2e-test-workflow\/definitions\/\d+/, { timeout: 20_000 });

    // On the definition page the workflow name is shown as a heading
    const header = pageHeader(page);
    const workflowHeading = header.locator('h1');
    await expect(workflowHeading).toBeVisible({ timeout: 10_000 });
    await expect(workflowHeading).toHaveText('e2e-test-workflow');
    await showResult(page);

    await endRecording(page);
  });

  // ── Validation gates ─────────────────────────────────────────────────────

  test('new workflow save blocked when workflow name slugifies to empty', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-new-validation', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/new`);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    const saveButton = page.getByRole('button', { name: /publish workflow/i });

    // Workflow name that slugifies to empty (only special chars → '')
    await page.getByPlaceholder('Workflow name…').fill('---');

    // Fill description — button still disabled because name slugifies to empty
    await page.getByPlaceholder('Add a description…').fill('Some description');

    // Button must remain disabled — toWorkflowId('---') === ''
    await expect(saveButton).toBeDisabled();
    await showResult(page);

    await endRecording(page);
  });

  // ── Pane click deselects step ─────────────────────────────────────────────

  test('clicking canvas pane deselects step and restores YAML panel', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-editor-pane-deselect', testInfo);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    // YAML editor is visible initially (no step selected)
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 });

    // Click a node — step editor opens, YAML editor hides
    await click(page, page.locator('.react-flow__node').first());
    await expect(page.locator('[data-testid="step-editor"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.cm-editor')).not.toBeVisible();
    await showStep(page);

    // Click empty canvas space — pane click triggers deselect, YAML editor returns
    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="step-editor"]')).not.toBeVisible();
    await showResult(page);

    await endRecording(page);
  });

  // ── Executor switching clears stale YAML fields ───────────────────────────

  test('executor chosen at creation is locked in the editor and reflected in YAML', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-editor-executor-switch', testInfo);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    // Add an agent step via edge "+" button
    await click(page, page.getByLabel('Add step here').first());
    await expect(page.getByText(/^step type$/i)).toBeVisible({ timeout: 3_000 });
    await click(page, stepTypeButton(page, 'Creation'));
    await expect(page.getByText(/who handles this step\?/i)).toBeVisible({ timeout: 3_000 });
    await click(page, executorButton(page, 'agent'));
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 5_000 });

    // Click the new step node — step editor opens showing the icon header
    await click(page, page.locator('.react-flow__node').filter({ hasText: /New Step/i }));
    const stepEditor = page.locator('[data-testid="step-editor"]');
    await expect(stepEditor).toBeVisible({ timeout: 5_000 });
    await showStep(page);

    // Executor is shown as a read-only locked field (no toggle buttons)
    await expect(stepEditor.getByText('executor')).toBeVisible();
    await expect(stepEditor.getByTitle(/executor is set at creation/i)).toBeVisible();
    // The icon header shows the Agent label (exact match avoids tooltip text false positives)
    await expect(stepEditor.getByText('Agent', { exact: true })).toBeVisible();
    await showStep(page);

    // Deselect and verify YAML reflects agent executor with plugin field
    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
    const yamlContent = page.locator('.cm-content');
    await expect(yamlContent).toBeVisible({ timeout: 10_000 });
    await expect(yamlContent).toContainText('executor: agent');
    await expect(yamlContent).toContainText('opencode-agent');
    await showResult(page);

    await endRecording(page);
  });

  // ── Cowork step ───────────────────────────────────────────────────────────

  test('cowork step appears in diagram and editor shows configuration', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-editor-cowork', testInfo);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    // Add a cowork step via edge "+" button
    await click(page, page.getByLabel('Add step here').first());
    await expect(page.getByText(/^step type$/i)).toBeVisible({ timeout: 3_000 });
    await click(page, stepTypeButton(page, 'Creation'));
    await expect(page.getByText(/who handles this step\?/i)).toBeVisible({ timeout: 3_000 });
    await click(page, executorButton(page, 'cowork'));
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 5_000 });
    await showStep(page);

    // New node shows "Cowork" executor label in the diagram
    await expect(page.locator('.react-flow__node').getByText('Cowork').first()).toBeVisible({ timeout: 3_000 });

    // Click the new step to open the step editor
    await click(page, page.locator('.react-flow__node').filter({ hasText: /New Step/i }));
    // Step editor opens with the cowork explainer for a new step
    await expect(page.getByText(/What is a Cowork step/i)).toBeVisible({ timeout: 3_000 });
    await showStep(page);

    // Chat / Voice toggle is visible, Chat is active by default
    await expect(page.getByRole('button', { name: /^Chat$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Voice$/i })).toBeVisible();

    // System prompt textarea is visible and fillable
    const systemPromptTextarea = page.getByPlaceholder(/Instructions for the AI collaborator/i);
    await expect(systemPromptTextarea).toBeVisible();
    await systemPromptTextarea.fill('You are a helpful clinical trial data analyst.');
    // Verify the value was accepted
    await expect(systemPromptTextarea).toHaveValue('You are a helpful clinical trial data analyst.');
    await showStep(page);

    // Deselect to see YAML — verify executor is reflected in source code
    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
    const yamlContent = page.locator('.cm-content');
    await expect(yamlContent).toBeVisible({ timeout: 10_000 });
    await expect(yamlContent).toContainText('executor: cowork', { timeout: 5_000 });
    await showResult(page);

    await endRecording(page);
  });

  test('cowork step MCP server editor supports add, fill, transport toggle, and remove', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-editor-cowork-mcp', testInfo);
    await page.goto(SUPPLY_CHAIN_DEFINITION_URL);

    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    const initialNodeCount = await page.locator('.react-flow__node').count();

    // Add a cowork step
    await click(page, page.getByLabel('Add step here').first());
    await click(page, stepTypeButton(page, 'Creation'));
    await click(page, executorButton(page, 'cowork'));
    await expect(page.locator('.react-flow__node')).toHaveCount(initialNodeCount + 1, { timeout: 5_000 });

    // Open the new step editor
    await click(page, page.locator('.react-flow__node').filter({ hasText: /New Step/i }));
    await expect(page.getByText(/What is a Cowork step/i)).toBeVisible({ timeout: 3_000 });

    // Scope MCP edits to the step editor side panel.
    const sidePanel = page.locator('div.border-l');

    // Empty-state hint is visible before adding any server.
    await expect(sidePanel.getByText(/No MCP servers configured/i)).toBeVisible();
    await expect(sidePanel.getByText('MCP Servers', { exact: true })).toBeVisible();

    // Click Add — a server entry with name/command inputs appears.
    await click(page, sidePanel.getByRole('button', { name: /^Add$/ }));
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
    await showStep(page);

    // Transport toggle switches the visible input to URL mode and back.
    const transportToggle = sidePanel.getByRole('button', { name: /^stdio$/ });
    await click(page, transportToggle);
    await expect(sidePanel.getByPlaceholder(/localhost:8080\/mcp/)).toBeVisible();
    await expect(sidePanel.getByPlaceholder(/e\.g\. tealflow-mcp/)).not.toBeVisible();

    await click(page, sidePanel.getByRole('button', { name: /^http$/ }));
    await expect(sidePanel.getByPlaceholder(/e\.g\. tealflow-mcp/)).toBeVisible();
    await showStep(page);

    // Remove — empty state returns.
    await click(page, sidePanel.locator('button').filter({ has: page.locator('svg.lucide-trash-2') }));
    await expect(sidePanel.getByText(/No MCP servers configured/i)).toBeVisible();
    await showResult(page);

    await endRecording(page);
  });
});
