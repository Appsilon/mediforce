import { test, expect } from '@playwright/test';

test.describe('Workflow Definitions', () => {
  test('[RENDER] workflow detail page has Definitions tab', async ({ page }) => {
    await page.goto('/workflows');
    // Click first workflow link
    const firstWorkflow = page.locator('a[href*="/workflows/"]').first();
    await firstWorkflow.click();
    await expect(page.getByRole('tab', { name: /definitions/i })).toBeVisible();
  });

  test('[RENDER] Definitions tab shows version list', async ({ page }) => {
    await page.goto('/workflows');
    const firstWorkflow = page.locator('a[href*="/workflows/"]').first();
    await firstWorkflow.click();
    await page.getByRole('tab', { name: /definitions/i }).click();

    // Should show at least one version link
    await expect(page.locator('a[href*="/definitions/"]').first()).toBeVisible({ timeout: 10000 });
  });

  test('[RENDER] definition version page shows diagram and step details', async ({ page }) => {
    await page.goto('/workflows');
    const firstWorkflow = page.locator('a[href*="/workflows/"]').first();
    await firstWorkflow.click();
    await page.getByRole('tab', { name: /definitions/i }).click();

    // Click first version
    const versionLink = page.locator('a[href*="/definitions/"]').first();
    await versionLink.click();

    // Should show version badge
    await expect(page.locator('text=/v\\d+/')).toBeVisible();

    // Should have Edit and Start Run buttons
    await expect(page.getByRole('button', { name: /edit/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /start run/i })).toBeVisible();

    // Should show at least one step node in the diagram (ReactFlow renders nodes)
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 5000 });
  });

  test('[CLICK] Edit toggle enables edit mode', async ({ page }) => {
    await page.goto('/workflows');
    const firstWorkflow = page.locator('a[href*="/workflows/"]').first();
    await firstWorkflow.click();
    await page.getByRole('tab', { name: /definitions/i }).click();
    const versionLink = page.locator('a[href*="/definitions/"]').first();
    await versionLink.click();

    // Click Edit
    await page.getByRole('button', { name: /^edit$/i }).click();

    // Should show editing badge and Save/Cancel buttons
    await expect(page.locator('text=editing')).toBeVisible();
    await expect(page.getByRole('button', { name: /save new version/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();
  });

  test('[CLICK] clicking a step node opens detail panel', async ({ page }) => {
    await page.goto('/workflows');
    const firstWorkflow = page.locator('a[href*="/workflows/"]').first();
    await firstWorkflow.click();
    await page.getByRole('tab', { name: /definitions/i }).click();
    const versionLink = page.locator('a[href*="/definitions/"]').first();
    await versionLink.click();

    // Wait for diagram to render
    await page.locator('.react-flow__node').first().waitFor({ timeout: 5000 });

    // Click first non-terminal node
    await page.locator('.react-flow__node').first().click();

    // Should show step details panel
    await expect(page.locator('text=Step details')).toBeVisible();
  });

  test('[RENDER] Start Run button is present on workflow overview', async ({ page }) => {
    await page.goto('/workflows');
    const firstWorkflow = page.locator('a[href*="/workflows/"]').first();
    await firstWorkflow.click();

    // On Runs tab, Start Run should be available
    await expect(page.getByRole('button', { name: /start run/i }).first()).toBeVisible();
  });
});
