import { test, expect } from '@playwright/test';

test.describe('Workflow Definitions', () => {
  test('[RENDER] workflow detail page has Runs and Definitions tabs', async ({ page }) => {
    await page.goto('/workflows/Supply%20Chain%20Review');
    await expect(page.getByRole('tab', { name: /runs/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: /definitions/i })).toBeVisible();
  });

  test('[RENDER] Runs tab is the default tab', async ({ page }) => {
    await page.goto('/workflows/Supply%20Chain%20Review');
    const runsTab = page.getByRole('tab', { name: /runs/i });
    await expect(runsTab).toBeVisible({ timeout: 10_000 });
    await expect(runsTab).toHaveAttribute('data-state', 'active');
  });

  test('[RENDER] Configurations tab no longer exists', async ({ page }) => {
    await page.goto('/workflows/Supply%20Chain%20Review');
    await expect(page.getByRole('tab', { name: /configurations/i })).not.toBeVisible();
  });

  test('[RENDER] Definitions tab shows seeded version', async ({ page }) => {
    await page.goto('/workflows/Supply%20Chain%20Review');
    await page.getByRole('tab', { name: /definitions/i }).click();
    // Should show v1 from seeded workflowDefinitions
    await expect(page.locator('text=v1')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=latest')).toBeVisible();
  });

  test('[RENDER] definition version page shows diagram', async ({ page }) => {
    await page.goto('/workflows/Supply%20Chain%20Review/definitions/1');
    // Should show version badge
    await expect(page.locator('text=v1')).toBeVisible({ timeout: 10_000 });
    // Should show diagram nodes
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 5_000 });
    // Should have Edit and Start Run buttons
    await expect(page.getByRole('button', { name: /^edit$/i })).toBeVisible();
  });

  test('[CLICK] Edit button enables edit mode with Cancel and Save', async ({ page }) => {
    await page.goto('/workflows/Supply%20Chain%20Review/definitions/1');
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 5_000 });

    // Click Edit
    await page.getByRole('button', { name: /^edit$/i }).click();

    // Should show editing badge and action buttons
    await expect(page.locator('text=editing')).toBeVisible();
    await expect(page.getByRole('button', { name: /save new version/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();
  });

  test('[CLICK] clicking a step node opens detail panel', async ({ page }) => {
    await page.goto('/workflows/Supply%20Chain%20Review/definitions/1');
    await page.locator('.react-flow__node').first().waitFor({ timeout: 5_000 });

    // Click first node
    await page.locator('.react-flow__node').first().click();

    // Should show step details panel
    await expect(page.locator('text=Step details')).toBeVisible();
  });

  test('[CLICK] Edit mode: clicking a step opens editable panel', async ({ page }) => {
    await page.goto('/workflows/Supply%20Chain%20Review/definitions/1');
    await page.locator('.react-flow__node').first().waitFor({ timeout: 5_000 });

    // Enable edit mode
    await page.getByRole('button', { name: /^edit$/i }).click();
    await expect(page.locator('text=editing')).toBeVisible();

    // Click first step node
    await page.locator('.react-flow__node').first().click();

    // Should show "Edit step" panel with executor toggle
    await expect(page.locator('text=Edit step')).toBeVisible();
    // Should have Human/Agent toggle
    await expect(page.getByRole('button', { name: /human/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /agent/i })).toBeVisible();
  });

  test('[CLICK] Edit mode: "+" button adds a new step', async ({ page }) => {
    await page.goto('/workflows/Supply%20Chain%20Review/definitions/1');
    await page.locator('.react-flow__node').first().waitFor({ timeout: 5_000 });

    // Count initial nodes
    const initialCount = await page.locator('.react-flow__node').count();

    // Enable edit mode
    await page.getByRole('button', { name: /^edit$/i }).click();

    // Click first "+" button
    const addButton = page.locator('.react-flow__node button:has-text("+")').first();
    await expect(addButton).toBeVisible({ timeout: 3_000 });
    await addButton.click();

    // Should have one more node
    await expect(page.locator('.react-flow__node')).toHaveCount(initialCount + 2, { timeout: 3_000 });
    // +2 because new step node + new "+" node between
  });

  test('[CLICK] Cancel editing discards changes', async ({ page }) => {
    await page.goto('/workflows/Supply%20Chain%20Review/definitions/1');
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
