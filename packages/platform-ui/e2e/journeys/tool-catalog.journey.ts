import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Tool Catalog Journey', () => {
  test('browse tool catalog, search, and view tool detail', async ({ page }, testInfo) => {
    await setupRecording(page, 'tool-catalog', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/tools`);
    await expect(page.getByRole('heading', { name: 'Tools' })).toBeVisible({ timeout: 10_000 });

    // Access control banner visible
    await expect(page.getByText('Per-step access control')).toBeVisible();
    await showStep(page);

    // Category sections visible
    await expect(page.getByText('Development').first()).toBeVisible();
    await expect(page.getByText('Data Access').first()).toBeVisible();
    await expect(page.getByText('Clinical Data').first()).toBeVisible();

    // Tool cards visible
    await expect(page.getByText('GitHub').first()).toBeVisible();
    await expect(page.getByText('PostgreSQL').first()).toBeVisible();
    await expect(page.getByText('CDISC Library').first()).toBeVisible();
    await showStep(page);

    // Secrets badges visible
    await expect(page.getByText('GITHUB_TOKEN').first()).toBeVisible();
    await expect(page.getByText('DATABASE_URL').first()).toBeVisible();

    // Tool access badges
    await expect(page.getByText('1 tool allowed').first()).toBeVisible(); // PostgreSQL
    await expect(page.getByText('All tools available').first()).toBeVisible();
    await showStep(page);

    // Search filters tools
    await click(page, page.getByPlaceholder('Search tools...'));
    await page.getByPlaceholder('Search tools...').fill('postgres');
    await expect(page.getByText('PostgreSQL').first()).toBeVisible();
    await expect(page.getByText('GitHub')).not.toBeVisible();
    await showStep(page);

    // Clear search
    await page.getByPlaceholder('Search tools...').fill('');
    await expect(page.getByText('GitHub').first()).toBeVisible();

    // Navigate to tool detail
    const detailLinks = page.getByRole('link', { name: 'Details' });
    await click(page, detailLinks.first());
    await expect(page.getByText('Connection')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Available Tools')).toBeVisible();
    await showStep(page);

    // Tool detail shows tools list
    await expect(page.getByText('search_code').first()).toBeVisible();
    await showStep(page);

    // Usage snippet visible
    await expect(page.getByText('Usage in Workflow Definition')).toBeVisible();
    await expect(page.getByText('mcpServers').first()).toBeVisible();
    await showResult(page);

    // Navigate back
    await click(page, page.getByRole('link', { name: 'Back to Tools' }));
    await expect(page.getByRole('heading', { name: 'Tools' })).toBeVisible({ timeout: 10_000 });
    await endRecording(page);
  });
});
