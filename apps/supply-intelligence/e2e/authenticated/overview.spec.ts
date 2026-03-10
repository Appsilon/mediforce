import { test, expect } from '@playwright/test';

test.describe('Overview page', () => {
  test('shows KPI cards with numeric values', async ({ page }) => {
    await page.goto('/overview');
    // Wait for data to load (KPI cards container appears)
    await page.waitForSelector('[data-testid="kpi-cards"]', { timeout: 15_000 });

    // Verify all 5 KPI cards are rendered
    const cards = page.locator('[data-testid="kpi-card"]');
    await expect(cards).toHaveCount(5);

    // Verify key KPI labels are visible
    await expect(page.getByText(/EUR Expiry Risk/i)).toBeVisible();
    await expect(page.getByText(/EUR Stockout Risk/i)).toBeVisible();
    await expect(page.getByText(/Red SKU/i)).toBeVisible();
  });

  test('shows warehouse ranking chart', async ({ page }) => {
    await page.goto('/overview');
    await page.waitForSelector('[data-testid="top-warehouses-chart"]', { timeout: 15_000 });

    // Recharts renders SVG -- verify the chart container exists
    const chart = page.locator('[data-testid="top-warehouses-chart"]');
    await expect(chart).toBeVisible();
  });

  test('shows category risk chart', async ({ page }) => {
    await page.goto('/overview');
    await page.waitForSelector('[data-testid="category-risk-chart"]', { timeout: 15_000 });

    const chart = page.locator('[data-testid="category-risk-chart"]');
    await expect(chart).toBeVisible();
  });

  test('shows AI summary placeholder', async ({ page }) => {
    await page.goto('/overview');
    await expect(page.getByText(/AI.*summary/i)).toBeVisible({ timeout: 15_000 });
  });
});
