import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Tool Catalog Journey', () => {
  test('browse live tool catalog, search, and view entry detail', async ({ page }, testInfo) => {
    await setupRecording(page, 'tool-catalog', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/tools`);
    await expect(page.getByRole('heading', { name: 'Tools' })).toBeVisible({ timeout: 10_000 });

    // Section heading + seeded stdio catalog entries (ids are shown verbatim).
    await expect(page.getByRole('heading', { level: 2, name: /stdio servers/i })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'filesystem' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'postgres' })).toBeVisible();
    await showStep(page);

    // Security badges: postgres has {{SECRET:DATABASE_URL}}, filesystem is open.
    await expect(page.getByText(/secrets required/i).first()).toBeVisible();
    await expect(page.getByText(/open access/i).first()).toBeVisible();
    await showStep(page);

    // Admins see the "Manage catalog" shortcut.
    await expect(page.getByRole('link', { name: /manage catalog/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /add http binding/i })).toBeVisible();

    // Search filters entries by id.
    await click(page, page.getByPlaceholder('Search tools...'));
    await page.getByPlaceholder('Search tools...').fill('postgres');
    await expect(page.getByRole('heading', { level: 3, name: 'postgres' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'filesystem' })).not.toBeVisible();
    await showStep(page);

    await page.getByPlaceholder('Search tools...').fill('');
    await expect(page.getByRole('heading', { level: 3, name: 'filesystem' })).toBeVisible();

    // Navigate into detail.
    await click(page, page.getByRole('heading', { level: 3, name: 'postgres' }));
    await expect(page.getByText('Connection')).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Detail shows the env variable and the usage section (empty, no agents bound yet).
    await expect(page.getByText('DATABASE_URL').first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: /used by agents/i })).toBeVisible();
    await expect(page.getByText(/no agent bindings reference this entry yet/i)).toBeVisible();
    await showStep(page);

    // Usage snippet visible.
    await expect(page.getByText(/usage in agent definition/i)).toBeVisible();
    await expect(page.getByText('mcpServers').first()).toBeVisible();
    await showResult(page);

    await click(page, page.getByRole('link', { name: /back to tools/i }));
    await expect(page.getByRole('heading', { name: 'Tools' })).toBeVisible({ timeout: 10_000 });
    await endRecording(page);
  });
});
