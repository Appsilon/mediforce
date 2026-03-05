import { test, expect } from '@playwright/test';

test.describe('Agent Catalog', () => {
  test('[RENDER] Catalog page loads and shows page title', async ({ page }) => {
    await page.goto('/catalog');
    await expect(
      page.getByRole('heading', { name: 'Agent Catalog' }),
    ).toBeVisible();
    await expect(
      page.getByText('Available AI capabilities for process configuration'),
    ).toBeVisible();
  });

  test('[RENDER] Catalog page displays plugin cards', async ({ page }) => {
    await page.goto('/catalog');
    // Wait for at least one plugin card to appear (cards have rounded-lg border)
    await expect(page.getByText('Risk Detection')).toBeVisible({ timeout: 10_000 });
  });

  test('[RENDER] Plugin cards show namespace group headings', async ({ page }) => {
    await page.goto('/catalog');
    await expect(page.getByRole('heading', { name: 'Supply Intelligence' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('heading', { name: 'Supply Intelligence' })).toBeVisible();
  });

  test('[RENDER] Plugin cards display metadata', async ({ page }) => {
    await page.goto('/catalog');
    // Check that a plugin name and its description are visible
    await expect(page.getByText('Risk Detection')).toBeVisible({ timeout: 10_000 });
    // Check for Input/Output labels
    await expect(page.getByText('Input').first()).toBeVisible();
    await expect(page.getByText('Output').first()).toBeVisible();
    // Check for role badges
    await expect(page.getByText('Executor').first()).toBeVisible();
  });

  test('[CLICK] Sidebar Agent Catalog link navigates to /catalog', async ({ page }) => {
    await page.goto('/tasks');
    await page.getByRole('link', { name: /agent catalog/i }).click();
    await expect(page).toHaveURL(/\/catalog/);
    await expect(
      page.getByRole('heading', { name: 'Agent Catalog' }),
    ).toBeVisible();
  });
});
