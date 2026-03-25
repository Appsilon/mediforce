import { test, expect } from '@playwright/test';
import { TEST_ORG_HANDLE } from '../helpers/constants';

test.describe('Agents', () => {
  test('[RENDER] Agents page loads and shows page title', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/agents`);
    await expect(
      page.getByRole('heading', { name: 'Agents' }),
    ).toBeVisible();
  });

  test('[RENDER] Agents page displays plugin cards', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/agents`);
    // Wait for at least one plugin card to appear (cards have rounded-lg border)
    await expect(page.getByText('Risk Detection')).toBeVisible({ timeout: 10_000 });
  });

  test('[RENDER] Plugin cards display metadata', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/agents`);
    await expect(page.getByText('Risk Detection')).toBeVisible({ timeout: 10_000 });
    // Check for Input/Output labels
    await expect(page.getByText('Input').first()).toBeVisible();
    await expect(page.getByText('Output').first()).toBeVisible();
  });

  test('[RENDER] Available Agents tab shows search field', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/agents`);
    await expect(page.getByPlaceholder(/search agents/i)).toBeVisible({ timeout: 10_000 });
  });

  test('[RENDER] New Agent button is visible', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/agents`);
    await expect(page.getByRole('link', { name: 'New Agent', exact: true })).toBeVisible();
  });

  test('[RENDER] New Agent page loads with form fields', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/agents/new`);
    await expect(page.getByRole('heading', { name: 'New Agent' })).toBeVisible();
    await expect(page.getByPlaceholder(/e\.g\. Risk Analysis Agent/i)).toBeVisible();
    await expect(page.getByText('Foundation model')).toBeVisible();
    await expect(page.getByRole('button', { name: /save new agent/i })).toBeVisible();
  });

  test('[CLICK] Sidebar Agents link navigates to /agents', async ({ page }) => {
    await page.goto(`/${TEST_ORG_HANDLE}/tasks`);
    await page.getByRole('link', { name: /^agents$/i }).click();
    await expect(page).toHaveURL(/\/agents/);
    await expect(
      page.getByRole('heading', { name: 'Agents' }),
    ).toBeVisible();
  });
});
