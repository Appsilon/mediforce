import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Tool Catalog Journey', () => {
  test('browse tool catalog, search, and view tool detail', async ({ page }, testInfo) => {
    await setupRecording(page, 'tool-catalog', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/tools`);
    await expect(page.getByRole('heading', { name: 'Tools' })).toBeVisible({ timeout: 10_000 });

    // Category sections visible
    await expect(page.getByText('Data Access').first()).toBeVisible();
    await expect(page.getByText('Clinical Data').first()).toBeVisible();

    // Tool cards visible
    await expect(page.getByText('Filesystem').first()).toBeVisible();
    await expect(page.getByText('PostgreSQL').first()).toBeVisible();
    await expect(page.getByText('CDISC Library').first()).toBeVisible();
    await showStep(page);

    // Security level badges visible
    await expect(page.getByText('Allowlist + secrets').first()).toBeVisible(); // PostgreSQL
    await expect(page.getByText('Open access').first()).toBeVisible(); // Filesystem
    await showStep(page);

    // Search filters tools
    await click(page, page.getByPlaceholder('Search tools...'));
    await page.getByPlaceholder('Search tools...').fill('postgres');
    await expect(page.getByText('PostgreSQL').first()).toBeVisible();
    await expect(page.getByText('Filesystem')).not.toBeVisible();
    await showStep(page);

    // Clear search
    await page.getByPlaceholder('Search tools...').fill('');
    await expect(page.getByText('Filesystem').first()).toBeVisible();

    // Navigate to tool detail (whole card is a link)
    await click(page, page.getByText('PostgreSQL').first());
    await expect(page.getByText('Connection')).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Tool detail shows secrets and allowlist
    await expect(page.getByText('DATABASE_URL').first()).toBeVisible();
    await expect(page.getByText('Tool Allowlist')).toBeVisible();
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
