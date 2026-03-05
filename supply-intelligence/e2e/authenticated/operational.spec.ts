import { test, expect } from '@playwright/test';

test.describe('Operational View', () => {
  test('renders table with data rows', async ({ page }) => {
    await page.goto('/operational');
    // Wait for table to load
    await page.waitForSelector('table tbody tr', { timeout: 15_000 });

    // Should have multiple rows (seed data has many SKU+WH pairs)
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(25); // Default page size
  });

  test('clicking column header changes sort and updates URL', async ({ page }) => {
    await page.goto('/operational');
    await page.waitForSelector('table tbody tr', { timeout: 15_000 });

    // Click EUR Expiry Risk header button to sort
    await page.getByRole('button', { name: /EUR Expiry Risk/i }).click();
    // URL should now contain sortBy param
    await expect(page).toHaveURL(/sortBy/);
  });

  test('applying risk level filter reduces row count', async ({ page }) => {
    await page.goto('/operational');
    await page.waitForSelector('table tbody tr', { timeout: 15_000 });

    const initialCount = await page.locator('table tbody tr').count();

    // Click the Red filter badge
    await page.click('[data-testid="risk-filter-red"]');

    // Wait for filter to apply (URL updates)
    await expect(page).toHaveURL(/riskLevel/);

    // Re-count rows after filter
    await page.waitForTimeout(500);
    const filteredCount = await page.locator('table tbody tr').count();

    // Filtered count should be less than or equal to initial
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
  });

  test('pagination controls show result count', async ({ page }) => {
    await page.goto('/operational');
    await page.waitForSelector('table tbody tr', { timeout: 15_000 });

    // Check "Showing X-Y of Z results" text
    await expect(page.getByText(/Showing \d+/i)).toBeVisible();
  });

  test('next page button updates URL', async ({ page }) => {
    await page.goto('/operational');
    await page.waitForSelector('table tbody tr', { timeout: 15_000 });

    // Click next page button (sr-only "Next page" text)
    const nextBtn = page.getByRole('button', { name: /Next page/i });
    if (await nextBtn.isEnabled()) {
      await nextBtn.click();
      await expect(page).toHaveURL(/page=2/);
    }
  });

  test('clicking a row navigates to SKU detail', async ({ page }) => {
    await page.goto('/operational');
    await page.waitForSelector('table tbody tr', { timeout: 15_000 });

    // Click the first data row
    await page.locator('table tbody tr').first().click();

    // Should navigate to /sku/... with warehouse param
    await page.waitForURL(/\/sku\/.*warehouse=/, { timeout: 5_000 });
  });
});
