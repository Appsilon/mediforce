import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

/**
 * Journey 3 — step MCP restrictions
 *
 * Workflow author opens a step whose agent has a stdio MCP binding
 * (`mcp-test-agent.mcpServers.filesystem`) and narrows it at step level:
 * disables the server on one step, then adds a denyTools entry on another
 * step. Verifies the wd.json source reflects both changes.
 */

const WORKFLOW_URL = `/${TEST_ORG_HANDLE}/workflows/MCP%20Restrictions%20Test/definitions/1`;

test.describe('Step MCP Restrictions Journey', () => {
  test('agent step shows restrictions panel, disable + denyTools surface in wd.json', async ({ page }) => {
    trackPageErrors(page);

    await page.goto(WORKFLOW_URL);
    // Diagram renders
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 15_000 });

    // Click the agent node (the first step is "Process" with agentId set)
    await page.locator('.react-flow__node').filter({ hasText: 'Process' }).first().click();
    await expect(page.locator('[data-testid="step-editor"]')).toBeVisible({ timeout: 5_000 });

    // MCP Restrictions section appears with one server hydrated from
    // /api/agents/mcp-test-agent/mcp-servers. Section titles in the
    // step editor render as styled <p> labels, not semantic headings.
    const sidePanel = page.locator('[data-testid="step-editor"]');
    await expect(sidePanel.getByText('MCP Restrictions', { exact: true })).toBeVisible({ timeout: 10_000 });
    // The binding list hydrates after an API call to
    // /api/agents/mcp-test-agent/mcp-servers. On cold compile this
    // route may take 15-20s to compile for the first time, so use a generous
    // timeout here.
    await expect(sidePanel.getByText('filesystem').first()).toBeVisible({ timeout: 30_000 });

    // Toggle "Disable" for filesystem
    const disableCheckbox = sidePanel.getByRole('checkbox', { name: /disable filesystem/i });
    await expect(disableCheckbox).toBeVisible();
    await disableCheckbox.click();
    await expect(disableCheckbox).toBeChecked();

    // Add a denyTools chip — type "write" into the add-chip input and press Enter
    const denyInput = sidePanel.getByPlaceholder(/deny tool/i);
    await expect(denyInput).toBeVisible();
    await denyInput.fill('write');
    await denyInput.press('Enter');
    await expect(sidePanel.getByText('write').first()).toBeVisible();

    // Deselect the step, then open the source modal — it reflects both edits.
    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
    await page.getByRole('button', { name: /workflow source code/i }).click();
    const jsonContent = page.locator('.cm-content');
    await expect(jsonContent).toBeVisible({ timeout: 10_000 });
    await expect(jsonContent).toContainText('mcpRestrictions', { timeout: 5_000 });
    await expect(jsonContent).toContainText('filesystem');
    await expect(jsonContent).toContainText('disable');
    await expect(jsonContent).toContainText('write');
  });
});
