import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

/**
 * Journey 2 — Agent MCP bindings
 *
 * A namespace member opens the agent editor, binds one stdio and one HTTP
 * server — both picked from the workspace catalog, never typed in — removes
 * the stdio one, then reloads to verify the http binding persists.
 *
 * Agent: `claude-code-agent` (plugin kind — with J1 gate removed in
 * `60ca453`, plugin agents may carry MCP bindings).
 */

test.describe('Agent MCP Bindings Journey', () => {
  test('bind stdio + http servers from the catalog, delete stdio, reload confirms http persists', async ({ page }) => {
    trackPageErrors(page);

    await page.goto(`/${TEST_ORG_HANDLE}/agents/definitions/claude-code-agent`);
    // Gate on the form's submit control, not on prose: the editor renders a
    // skeleton until the definition resolves, so Save changes appearing is
    // the load signal, and it survives copy edits to the page header.
    await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible({ timeout: 30_000 });

    const mcpHeading = page.getByRole('heading', { name: /mcp servers/i });
    await expect(mcpHeading).toBeVisible();
    await expect(page.getByText(/no mcp bindings yet|add a server/i).first()).toBeVisible();

    // ── Bind the stdio server ────────────────────────────────────────────
    await page.getByRole('button', { name: /add server/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Only catalog servers can be bound — there is nowhere to type a URL or command.
    await expect(dialog.getByLabel(/^url$/i)).toHaveCount(0);
    await dialog.getByLabel('MCP server').selectOption('filesystem');
    await dialog.getByRole('button', { name: /create binding/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Remove filesystem' })).toBeVisible();

    // ── Bind the HTTP server ─────────────────────────────────────────────
    await page.getByRole('button', { name: /add server/i }).first().click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('MCP server').selectOption('github-mcp');
    await dialog.getByRole('button', { name: /create binding/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Remove github-mcp' })).toBeVisible();
    await expect(page.getByText(/api\.example\.com\/mcp/).first()).toBeVisible();

    // ── Delete stdio binding ─────────────────────────────────────────────
    await page.getByRole('button', { name: 'Remove filesystem' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /^(delete|confirm|remove)/i }).last().click();

    await expect(page.getByRole('button', { name: 'Remove filesystem' })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Remove github-mcp' })).toBeVisible();

    // ── Reload confirms http binding persists ─────────────────────────────
    await page.reload();
    await expect(page.getByRole('heading', { name: /mcp servers/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Remove github-mcp' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove filesystem' })).toHaveCount(0);

    // ── Cleanup — remove the persisted binding so the test is rerunnable ──
    await page.getByRole('button', { name: 'Remove github-mcp' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /^(delete|confirm|remove)/i }).last().click();
  });
});
