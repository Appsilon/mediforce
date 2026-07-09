import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

test.describe('Admin Tool Catalog Journey', () => {
  test('admin creates, edits, and deletes a catalog entry', async ({ page }) => {
    trackPageErrors(page);

    // ── Land on admin page ────────────────────────────────────────────────
    await page.goto(`/${TEST_ORG_HANDLE}/admin/tool-catalog`);
    await expect(page.getByRole('heading', { name: /tool catalog/i })).toBeVisible({ timeout: 30_000 });

    // Seeded entries render in the list; the right pane shows the idle
    // "select or create" state before any selection.
    await expect(page.getByText(/select an entry to edit|no catalog entries|add your first/i).first()).toBeVisible();

    // ── Create ────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /new catalog entry|add entry|new entry/i }).first().click();

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

    // Entry removed from list — remaining seeded entries still visible
    await expect(page.getByText('test-mcp')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/select an entry to edit|no catalog entries|add your first/i).first()).toBeVisible();
  });
});
