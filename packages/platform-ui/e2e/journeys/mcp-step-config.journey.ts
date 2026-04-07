import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';

test.describe('MCP Step Config Journey', () => {
  test('workflow definition step shows MCP server configuration', async ({ page }) => {
    // Navigate to Supply Chain Review definition (version 1)
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/definitions/1`);

    // Click on the vendor-assessment step node in the diagram
    const stepNode = page.getByTestId('rf__node-vendor-assessment');
    await expect(stepNode).toBeVisible({ timeout: 15_000 });
    await stepNode.click();

    // MCP Tools section should be visible with 2 servers
    await expect(page.getByText('MCP Tools (2)')).toBeVisible({ timeout: 5_000 });

    // Individual server names visible
    await expect(page.getByText('postgres-ro')).toBeVisible();
    await expect(page.getByText('filesystem')).toBeVisible();
  });
});
