import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

test.describe('Tool Catalog Journey', () => {
  test('browse live tool catalog, search, and view entry detail', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/tools`);
    await expect(page.getByRole('heading', { name: 'Tools' })).toBeVisible({ timeout: 10_000 });

    // Section heading + seeded stdio catalog entries (ids are shown verbatim).
    // Long timeout covers the initial admin API fetch + hydration on cold server.
    await expect(page.getByRole('heading', { level: 2, name: /stdio servers/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 3, name: 'filesystem' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'postgres' })).toBeVisible();

    // Security badges: postgres has {{SECRET:DATABASE_URL}}, filesystem is open.
    await expect(page.getByText(/secrets required/i).first()).toBeVisible();
    await expect(page.getByText(/open access/i).first()).toBeVisible();

    // Admins see the "Manage catalog" shortcut.
    await expect(page.getByRole('link', { name: /manage catalog/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /add http binding/i })).toBeVisible();

    // Search filters entries by id.
    await page.getByPlaceholder('Search tools...').click();
    await page.getByPlaceholder('Search tools...').fill('postgres');
    await expect(page.getByRole('heading', { level: 3, name: 'postgres' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'filesystem' })).not.toBeVisible();

    await page.getByPlaceholder('Search tools...').fill('');
    await expect(page.getByRole('heading', { level: 3, name: 'filesystem' })).toBeVisible();

    // Navigate into detail. First-time compile of /tools/[toolId] on a cold
    // dev server can exceed 10s, so use a longer timeout for the first
    // visible element on the detail page.
    await page.getByRole('heading', { level: 3, name: 'postgres' }).click();
    await expect(page.getByText('Connection')).toBeVisible({ timeout: 30_000 });

    // Detail shows the env variable and the usage section (empty, no agents bound yet).
    await expect(page.getByText('DATABASE_URL').first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: /used by agents/i })).toBeVisible();
    await expect(page.getByText(/no agent bindings reference this entry yet/i)).toBeVisible();

    // Usage snippet visible.
    await expect(page.getByText(/usage in agent definition/i)).toBeVisible();
    await expect(page.getByText('mcpServers').first()).toBeVisible();

    await page.getByRole('link', { name: /back to tools/i }).click();
    await expect(page.getByRole('heading', { name: 'Tools' })).toBeVisible({ timeout: 10_000 });
  });
});
