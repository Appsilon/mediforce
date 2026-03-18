import { test, expect } from '@playwright/test';

test.describe('Agents', () => {
  test('[RENDER] Agents page loads and shows page title', async ({ page }) => {
    await page.goto('/agents');
    await expect(
      page.getByRole('heading', { name: 'Agents' }),
    ).toBeVisible();
  });

  test('[RENDER] Agents page displays plugin cards', async ({ page }) => {
    await page.goto('/agents');
    // Wait for at least one plugin card to appear (cards have rounded-lg border)
    await expect(page.getByText('Risk Detection')).toBeVisible({ timeout: 10_000 });
  });

  test('[RENDER] Plugin cards show namespace group headings', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.getByRole('heading', { name: 'Supply Intelligence' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('heading', { name: 'Supply Intelligence' })).toBeVisible();
  });

  test('[RENDER] Plugin cards display metadata', async ({ page }) => {
    await page.goto('/agents');
    // Check that a plugin name and its description are visible
    await expect(page.getByText('Risk Detection')).toBeVisible({ timeout: 10_000 });
    // Check for Input/Output labels
    await expect(page.getByText('Input').first()).toBeVisible();
    await expect(page.getByText('Output').first()).toBeVisible();
    // Check for role badges
    await expect(page.getByText('Executor').first()).toBeVisible();
  });

  test('[CLICK] Sidebar Agents link navigates to /agents', async ({ page }) => {
    await page.goto('/tasks');
    await page.getByRole('link', { name: /^agents$/i }).click();
    await expect(page).toHaveURL(/\/agents/);
    await expect(
      page.getByRole('heading', { name: 'Agents' }),
    ).toBeVisible();
  });
});
