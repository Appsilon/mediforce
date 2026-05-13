import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

/**
 * Journey 3 — step MCP restrictions
 *
 * Workflow author opens a step whose agent has a stdio MCP binding
 * (`mcp-test-agent.mcpServers.filesystem`) and narrows it at step level:
 * disables the server on one step, then adds a denyTools entry on another
 * step. Verifies the YAML source panel reflects both changes.
 */

const WORKFLOW_URL = `/${TEST_ORG_HANDLE}/workflows/MCP%20Restrictions%20Test/definitions/1`;

test.describe('Step MCP Restrictions Journey', () => {
  test('agent step shows restrictions panel, disable + denyTools surface in YAML', async ({ page }, testInfo) => {
    await setupRecording(page, 'step-mcp-restrictions', testInfo);

    await page.goto(WORKFLOW_URL);
    // Diagram renders
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 15_000 });
    await showStep(page);

    // Click the agent node (the first step is "Process" with agentId set)
    await click(page, page.locator('.react-flow__node').filter({ hasText: 'Process' }).first());
    await expect(page.locator('[data-testid="step-editor"]')).toBeVisible({ timeout: 5_000 });

    // MCP Restrictions section appears with one server hydrated from
    // /api/agent-definitions/mcp-test-agent/mcp-servers. Section titles in the
    // step editor render as styled <p> labels, not semantic headings.
    const sidePanel = page.locator('div.border-l');
    await expect(sidePanel.getByText('MCP Restrictions', { exact: true })).toBeVisible({ timeout: 10_000 });
    // The binding list hydrates after an API call to
    // /api/agent-definitions/mcp-test-agent/mcp-servers. On cold compile this
    // route may take 15-20s to compile for the first time, so use a generous
    // timeout here.
    await expect(sidePanel.getByText('filesystem').first()).toBeVisible({ timeout: 30_000 });
    await showStep(page);

    // Toggle "Disable" for filesystem
    const disableCheckbox = sidePanel.getByRole('checkbox', { name: /disable filesystem/i });
    await expect(disableCheckbox).toBeVisible();
    await click(page, disableCheckbox);
    await expect(disableCheckbox).toBeChecked();
    await showStep(page);

    // Add a denyTools chip — type "write" into the add-chip input and press Enter
    const denyInput = sidePanel.getByPlaceholder(/deny tool/i);
    await expect(denyInput).toBeVisible();
    await denyInput.fill('write');
    await denyInput.press('Enter');
    await expect(sidePanel.getByText('write').first()).toBeVisible();
    await showStep(page);

    // Deselect step — YAML panel returns and reflects both edits.
    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
    const yamlContent = page.locator('.cm-content');
    await expect(yamlContent).toBeVisible({ timeout: 10_000 });
    await expect(yamlContent).toContainText('mcpRestrictions', { timeout: 5_000 });
    await expect(yamlContent).toContainText('filesystem');
    await expect(yamlContent).toContainText('disable');
    await expect(yamlContent).toContainText('write');
    await showResult(page);

    await endRecording(page);
  });
});
