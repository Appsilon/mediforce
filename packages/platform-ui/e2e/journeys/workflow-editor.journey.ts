import { test, expect } from '@playwright/test';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { recordingReady, showStep, showResult } from '../helpers/recording';

test.describe('Workflow Editor Journey', () => {
  test('workflow detail shows tabs, definitions, and diagram', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review`);
    await recordingReady(page);

    // Runs and Definitions tabs visible
    await expect(page.getByRole('tab', { name: /runs/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: /definitions/i })).toBeVisible();

    // Runs tab is default
    const runsTab = page.getByRole('tab', { name: /runs/i });
    await expect(runsTab).toHaveAttribute('data-state', 'active');
    await showStep(page);

    // Configurations tab does NOT exist
    await expect(page.getByRole('tab', { name: /configurations/i })).not.toBeVisible();

    // Click Definitions tab
    await page.getByRole('tab', { name: /definitions/i }).click();
    await expect(
      page.locator('a[href*="/definitions/"]').or(page.locator('text=/No definitions|Create first/i')).first(),
    ).toBeVisible({ timeout: 10_000 });
    await showResult(page);
  });

  test('definition version shows diagram and supports edit mode', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/definitions/1`);
    await recordingReady(page);

    // Version badge and diagram
    await expect(page.locator('text=v1')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /^edit$/i })).toBeVisible();
    await showStep(page);

    // Click a step node -> Step details panel appears
    await page.locator('.react-flow__node').first().click();
    await expect(page.locator('text=Step details')).toBeVisible({ timeout: 5_000 });
    await showStep(page);

    // Enable edit mode — this should switch the panel to edit mode
    await page.getByRole('button', { name: /^edit$/i }).click();
    await expect(page.locator('text=editing')).toBeVisible();
    await expect(page.getByRole('button', { name: /save new version/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();
    await showResult(page);

    // Click a step node in edit mode -> Edit step panel
    await page.locator('.react-flow__node').nth(1).click();
    await expect(page.locator('text=Edit step')).toBeVisible({ timeout: 5_000 });
    await showStep(page);

    // Verify "+" button exists for adding steps (confirms edit mode is functional)
    const addButton = page.locator('.react-flow__node button:has-text("+")').first();
    await expect(addButton).toBeVisible({ timeout: 3_000 });

    // Cancel editing (accept dialog)
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /cancel/i }).click();

    // Back to view mode
    await expect(page.locator('text=editing')).not.toBeVisible();
    await expect(page.getByRole('button', { name: /^edit$/i })).toBeVisible();
    await showResult(page);
  });
});
