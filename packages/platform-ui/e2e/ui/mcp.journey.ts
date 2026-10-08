import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

test.describe('MCP Journey', () => {
  test('browse stdio and HTTP servers, search, and open one to edit', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/mcp`);
    await expect(page.getByRole('heading', { name: 'MCP', exact: true })).toBeVisible({ timeout: 10_000 });

    // Seeded stdio entries and the seeded HTTP entry, each in its section.
    // Long timeout covers the initial catalog fetch + hydration on cold server.
    await expect(page.getByRole('heading', { level: 2, name: /stdio servers/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 2, name: /http servers/i })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'filesystem' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'postgres' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'github-mcp' })).toBeVisible();

    // Security badges: postgres has {{SECRET:DATABASE_URL}}, filesystem is open,
    // github-mcp authenticates via OAuth.
    await expect(page.getByText(/secrets required/i).first()).toBeVisible();
    await expect(page.getByText(/open access/i).first()).toBeVisible();
    await expect(page.getByText(/^oauth$/i).first()).toBeVisible();

    // Search filters entries by id.
    await page.getByPlaceholder('Search MCP servers...').fill('postgres');
    await expect(page.getByRole('heading', { level: 3, name: 'postgres' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'filesystem' })).not.toBeVisible();
    await page.getByPlaceholder('Search MCP servers...').fill('');

    // Clicking the HTTP card opens its edit dialog, with the agent that binds it.
    await page.getByRole('button', { name: 'Edit github-mcp' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: /edit mcp server/i })).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByLabel('URL')).toHaveValue('https://api.example.com/mcp');
    await expect(dialog.getByText('OAuth Test Agent')).toBeVisible();
    await expect(page).toHaveURL(/\/mcp\?id=github-mcp$/);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();

    // The old Tools URL lands here.
    await page.goto(`/${TEST_ORG_HANDLE}/tools`);
    await expect(page).toHaveURL(new RegExp(`/${TEST_ORG_HANDLE}/mcp$`));
  });
});
