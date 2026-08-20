import { test, expect } from '../helpers/test-fixtures';
import { TEST_USER_ID } from '../helpers/constants';
import { seedPostgresOrganizationNamespace } from '../helpers/postgres-seed';
import { trackPageErrors } from '../helpers/page-errors';

const EMPTY_CATALOG_HANDLE = `tool-catalog-empty-${Date.now()}`;

test.describe('Admin Tool Catalog Journey', () => {
  test.beforeAll(async () => {
    // The shared `test` namespace deliberately has seeded catalog entries for
    // other journeys. Use a fresh owner namespace so this assertion exercises
    // the actual empty-catalog render instead of the seeded list state.
    await seedPostgresOrganizationNamespace(EMPTY_CATALOG_HANDLE, TEST_USER_ID, 'Tool Catalog Journey');
  });

  test('admin creates, edits, and deletes a catalog entry', async ({ page }) => {
    trackPageErrors(page);

    // ── Land on admin page ────────────────────────────────────────────────
    await page.goto(`/${EMPTY_CATALOG_HANDLE}/admin/tool-catalog`);
    await expect(page.getByRole('heading', { name: /tool catalog/i })).toBeVisible({ timeout: 30_000 });

    // This namespace is intentionally empty. The page must expose exactly one
    // create action: the header button, with no duplicate in the empty state.
    await expect(page.getByText('No catalog entries yet.').first()).toBeVisible();

    // ── Create ────────────────────────────────────────────────────────────
    const newCatalogEntryButton = page.getByRole('button', { name: /new catalog entry|add entry|new entry/i });
    await expect(newCatalogEntryButton).toHaveCount(1);
    await newCatalogEntryButton.click();

    await expect(page.getByRole('heading', { name: /new catalog entry|create/i }).first()).toBeVisible();
    await page.getByLabel(/^id$/i).fill('test-mcp');
    await page.getByLabel(/^command$/i).fill('npx');

    // args — useFieldArray. Add one argument: "-y" then "@example/mcp-server"
    await page.getByRole('button', { name: /add arg/i }).first().click();
    await page.getByLabel(/args?\s*0|arg 1/i).first().fill('-y');
    await page.getByRole('button', { name: /add arg/i }).first().click();
    await page.getByLabel(/args?\s*1|arg 2/i).first().fill('@example/mcp-server');

    await page.getByLabel(/description/i).fill('Test MCP server for the admin catalog journey.');

    await page.getByRole('button', { name: /^create$/i }).click();
    await expect(page.getByText('test-mcp').first()).toBeVisible({ timeout: 10_000 });

    // ── Edit ──────────────────────────────────────────────────────────────
    await page.getByText('test-mcp').first().click();
    await expect(page.getByLabel(/^command$/i)).toHaveValue('npx');

    const descriptionField = page.getByLabel(/description/i);
    await descriptionField.fill('Updated description via journey test.');
    await page.getByRole('button', { name: /^save$/i }).click();

    // Wait for save to finish (button returns from "Saving…" to "Save")
    await expect(page.getByRole('button', { name: /^save$/i })).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByLabel(/description/i)).toHaveValue(/updated description via journey test/i);

    // ── Delete ────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /^delete$/i }).click();

    // Dialog appears — confirm
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /^(delete|confirm)/i }).last().click();

    // Entry removed from the otherwise empty catalog.
    await expect(page.getByText('test-mcp')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/select an entry to edit|no catalog entries|add your first/i).first()).toBeVisible();
  });
});
