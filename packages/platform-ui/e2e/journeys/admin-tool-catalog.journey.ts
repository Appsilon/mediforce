import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Admin Tool Catalog Journey', () => {
  test('admin creates, edits, and deletes a catalog entry', async ({ page }, testInfo) => {
    await setupRecording(page, 'admin-tool-catalog', testInfo);

    // ── Land on admin page ────────────────────────────────────────────────
    await page.goto(`/${TEST_ORG_HANDLE}/admin/tool-catalog`);
    await expect(page.getByRole('heading', { name: /tool catalog/i })).toBeVisible({ timeout: 15_000 });

    // No entries yet — empty state visible, new-entry CTA visible
    await expect(page.getByText(/no catalog entries|get started|add your first/i).first()).toBeVisible();
    await showStep(page);

    // ── Create ────────────────────────────────────────────────────────────
    await click(page, page.getByRole('button', { name: /new catalog entry|add entry|new entry/i }).first());

    await expect(page.getByRole('heading', { name: /new catalog entry|create/i }).first()).toBeVisible();
    await page.getByLabel(/^id$/i).fill('test-mcp');
    await page.getByLabel(/^command$/i).fill('npx');

    // args — useFieldArray. Add one argument: "-y" then "@example/mcp-server"
    await click(page, page.getByRole('button', { name: /add arg/i }).first());
    await page.getByLabel(/args?\s*0|arg 1/i).first().fill('-y');
    await click(page, page.getByRole('button', { name: /add arg/i }).first());
    await page.getByLabel(/args?\s*1|arg 2/i).first().fill('@example/mcp-server');

    await page.getByLabel(/description/i).fill('Test MCP server for the admin catalog journey.');
    await showStep(page);

    await click(page, page.getByRole('button', { name: /^create$/i }));
    await expect(page.getByText('test-mcp').first()).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // ── Edit ──────────────────────────────────────────────────────────────
    await click(page, page.getByText('test-mcp').first());
    await expect(page.getByLabel(/^command$/i)).toHaveValue('npx');

    const descriptionField = page.getByLabel(/description/i);
    await descriptionField.fill('Updated description via journey test.');
    await click(page, page.getByRole('button', { name: /^save$/i }));

    // Wait for save to finish (button returns from "Saving…" to "Save")
    await expect(page.getByRole('button', { name: /^save$/i })).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByLabel(/description/i)).toHaveValue(/updated description via journey test/i);
    await showStep(page);

    // ── Delete ────────────────────────────────────────────────────────────
    await click(page, page.getByRole('button', { name: /^delete$/i }));

    // Dialog appears — confirm
    await expect(page.getByRole('dialog')).toBeVisible();
    await click(page, page.getByRole('button', { name: /^(delete|confirm)/i }).last());

    // Entry removed from list — back to empty state
    await expect(page.getByText('test-mcp')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/no catalog entries|get started|add your first/i).first()).toBeVisible();
    await showResult(page);
    await endRecording(page);
  });
});
