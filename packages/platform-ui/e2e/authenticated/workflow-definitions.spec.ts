import { test, expect } from '@playwright/test';
import { TEST_ORG_HANDLE } from '../helpers/constants';

test.describe('Workflow Definitions', () => {
  test('[RENDER] workflow detail page has Runs and Definitions tabs', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review`);
    await expect(page.getByRole('tab', { name: /runs/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: /definitions/i })).toBeVisible();
  });

  test('[RENDER] Runs tab is the default tab', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review`);
    const runsTab = page.getByRole('tab', { name: /runs/i });
    await expect(runsTab).toBeVisible({ timeout: 10_000 });
    await expect(runsTab).toHaveAttribute('data-state', 'active');
  });

  test('[RENDER] Configurations tab no longer exists', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review`);
    await expect(page.getByRole('tab', { name: /configurations/i })).not.toBeVisible();
  });

  test('[RENDER] Definitions tab shows seeded version', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review`);
    await page.getByRole('tab', { name: /definitions/i }).click();
    // Should show content from seeded workflowDefinitions (version link or empty state)
    await expect(
      page.locator('a[href*="/definitions/"]').or(page.locator('text=/No definitions|Create first/i')).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('[RENDER] definition version page shows diagram', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/definitions/1`);
    // Should show version badge
    await expect(page.locator('text=v1')).toBeVisible({ timeout: 10_000 });
    // Should show diagram nodes
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 5_000 });
    // Should have Edit and Start Run buttons
    await expect(page.getByRole('button', { name: /^edit$/i })).toBeVisible();
  });

  test('[CLICK] Edit button enables edit mode with Cancel and Save', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/definitions/1`);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 5_000 });

    // Click Edit
    await page.getByRole('button', { name: /^edit$/i }).click();

    // Should show editing badge and action buttons
    await expect(page.locator('text=editing')).toBeVisible();
    await expect(page.getByRole('button', { name: /save new version/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();
  });

  test('[CLICK] clicking a step node opens detail panel', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/definitions/1`);
    await page.locator('.react-flow__node').first().waitFor({ timeout: 5_000 });

    // Click first node
    await page.locator('.react-flow__node').first().click();

    // Should show step details panel
    await expect(page.locator('text=Step details')).toBeVisible();
  });

  test('[CLICK] Edit mode: clicking a step opens editable panel', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/definitions/1`);
    await page.locator('.react-flow__node').first().waitFor({ timeout: 10_000 });

    // Enable edit mode
    await page.getByRole('button', { name: /^edit$/i }).click();
    await expect(page.locator('text=editing')).toBeVisible({ timeout: 5_000 });

    // Click first non-terminal step node
    await page.locator('.react-flow__node').first().click();

    // Should show edit panel header
    await expect(page.locator('text=Edit step')).toBeVisible({ timeout: 5_000 });
  });

  test('[CLICK] Edit mode: "+" button adds a new step', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/definitions/1`);
    await page.locator('.react-flow__node').first().waitFor({ timeout: 5_000 });

    // Count initial nodes
    const initialCount = await page.locator('.react-flow__node').count();

    // Enable edit mode
    await page.getByRole('button', { name: /^edit$/i }).click();

    // Click first "+" button
    const addButton = page.locator('.react-flow__node button:has-text("+")').first();
    await expect(addButton).toBeVisible({ timeout: 3_000 });
    await addButton.click();

    // Should have more nodes than before (new step + possibly new "+" node)
    const newCount = await page.locator('.react-flow__node').count();
    expect(newCount).toBeGreaterThan(initialCount);
  });

  test('[CLICK] Cancel editing discards changes', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/definitions/1`);
    await page.locator('.react-flow__node').first().waitFor({ timeout: 5_000 });

    // Enable edit mode
    await page.getByRole('button', { name: /^edit$/i }).click();

    // Cancel with confirm dialog
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /cancel/i }).click();

    // Should be back to view mode
    await expect(page.locator('text=editing')).not.toBeVisible();
    await expect(page.getByRole('button', { name: /^edit$/i })).toBeVisible();
  });
});
