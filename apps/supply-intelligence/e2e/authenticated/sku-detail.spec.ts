import { test, expect } from '@playwright/test';

test.describe('SKU Detail page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate via Operational View -> click first row
    await page.goto('/operational');
    await page.waitForSelector('table tbody tr', { timeout: 15_000 });
    await page.locator('table tbody tr').first().click();
    await page.waitForURL(/\/sku\//, { timeout: 5_000 });
  });

  test('shows header with SKU name and metrics', async ({ page }) => {
    // Header should show SKU name, warehouse, and metrics
    await expect(page.locator('[data-testid="sku-header"]')).toBeVisible({ timeout: 10_000 });
    // Should show EUR risk values
    await expect(
      page.getByText(/EUR Expiry Risk|EUR Stockout Risk/i).first(),
    ).toBeVisible();
  });

  test('Expiry tab shows batch table', async ({ page }) => {
    // Expiry tab should be the default tab (named "Expiry Risk")
    await expect(page.getByRole('tab', { name: /Expiry/i })).toBeVisible();

    // Batch table should have rows within the expiry tab
    const batchRows = page.locator('[data-testid="expiry-tab"] table tbody tr');
    await expect(batchRows.first()).toBeVisible({ timeout: 10_000 });
  });

  test('Stockout tab shows weekly projection', async ({ page }) => {
    // Click the Stockout tab
    await page.getByRole('tab', { name: /Stockout/i }).click();

    // Projection table should show 4 weeks
    const projectionRows = page.locator('[data-testid="stockout-tab"] table tbody tr');
    await expect(projectionRows.first()).toBeVisible({ timeout: 10_000 });
    await expect(projectionRows).toHaveCount(4);
  });

  test('back button navigates to Operational View', async ({ page }) => {
    await page.locator('a[href="/operational"]').click();
    await page.waitForURL('**/operational**');
  });
});
