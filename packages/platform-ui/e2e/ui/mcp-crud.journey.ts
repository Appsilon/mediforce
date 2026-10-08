import { test, expect } from '../helpers/test-fixtures';
import { TEST_USER_ID } from '../helpers/constants';
import { seedPostgresOrganizationNamespace } from '../helpers/postgres-seed';
import { trackPageErrors } from '../helpers/page-errors';

const EMPTY_CATALOG_HANDLE = `tool-catalog-empty-${Date.now()}`;

test.describe('MCP CRUD Journey', () => {
  test.beforeAll(async () => {
    // The shared `test` namespace deliberately has seeded catalog entries for
    // other journeys. Use a fresh owner namespace so this assertion exercises
    // the actual empty-catalog render instead of the seeded list state.
    await seedPostgresOrganizationNamespace(EMPTY_CATALOG_HANDLE, TEST_USER_ID, 'Tool Catalog Journey');
  });

  test('adds a stdio and an HTTP server, edits one, and deletes it', async ({ page }) => {
    trackPageErrors(page);

    await page.goto(`/${EMPTY_CATALOG_HANDLE}/mcp`);
    await expect(page.getByRole('heading', { name: 'MCP', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/no mcp servers configured yet/i)).toBeVisible({ timeout: 30_000 });

    // ── Create stdio ──────────────────────────────────────────────────────
    await page.getByRole('button', { name: /add mcp/i }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add MCP server' })).toBeVisible();
    await dialog.getByLabel(/^id$/i).fill('test-mcp');
    await dialog.getByLabel(/^command$/i).fill('npx');
    await dialog.getByRole('button', { name: /add arg/i }).click();
    await dialog.getByLabel('Arg 1').fill('-y');
    await dialog.getByLabel(/description/i).fill('Test MCP server for the CRUD journey.');
    await dialog.getByRole('button', { name: /^create$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { level: 3, name: 'test-mcp' })).toBeVisible({ timeout: 10_000 });

    // ── Create HTTP ───────────────────────────────────────────────────────
    await page.getByRole('button', { name: /add mcp/i }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: 'HTTP' }).check();
    await dialog.getByLabel(/^id$/i).fill('remote-mcp');
    await dialog.getByLabel('URL').fill('https://mcp.example.com/mcp');
    await dialog.getByRole('radio', { name: 'Static headers' }).check();
    await dialog.getByRole('button', { name: /add header/i }).click();
    await dialog.getByLabel('Header key 1').fill('Authorization');
    await dialog.getByLabel('Header value 1').fill('Bearer {{SECRET:remote_token}}');
    await dialog.getByRole('button', { name: /^create$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { level: 2, name: /http servers/i })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'remote-mcp' })).toBeVisible();

    // ── Edit ──────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Edit remote-mcp' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Header value 1')).toHaveValue('Bearer {{SECRET:remote_token}}');
    await dialog.getByLabel('URL').fill('https://mcp.example.com/v2');
    await dialog.getByRole('button', { name: /^save$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('mcp.example.com').first()).toBeVisible();
    await page.getByRole('button', { name: 'Edit remote-mcp' }).click();
    await expect(page.getByRole('dialog').getByLabel('URL')).toHaveValue('https://mcp.example.com/v2');

    // ── Delete ────────────────────────────────────────────────────────────
    await page.getByRole('dialog').getByRole('button', { name: /^delete$/i }).click();
    await page.getByRole('button', { name: /^(delete|confirm)/i }).last().click();
    await expect(page.getByRole('heading', { level: 3, name: 'remote-mcp' })).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { level: 3, name: 'test-mcp' })).toBeVisible();
  });
});
