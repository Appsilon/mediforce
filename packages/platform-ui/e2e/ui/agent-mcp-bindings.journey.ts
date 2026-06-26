import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

/**
 * Journey 2 — Agent MCP bindings
 *
 * A namespace member opens the agent editor, adds one stdio binding (via
 * catalog dropdown) and one HTTP binding (URL + header), removes the stdio
 * one, then reloads to verify the http binding persists.
 *
 * Agent: `claude-code-agent` (plugin kind — with J1 gate removed in
 * `60ca453`, plugin agents may carry MCP bindings).
 */

test.describe('Agent MCP Bindings Journey', () => {
  test('add stdio + http bindings, delete stdio, reload confirms http persists', async ({ page }) => {
    trackPageErrors(page);

    await page.goto(`/${TEST_ORG_HANDLE}/agents/definitions/claude-code-agent`);
    await expect(page.getByText(/edit this ai agent/i)).toBeVisible({ timeout: 30_000 });

    // MCP Servers section visible (any kind — no warning copy)
    const mcpHeading = page.getByRole('heading', { name: /mcp servers/i });
    await expect(mcpHeading).toBeVisible();
    await expect(page.getByText(/no mcp bindings yet|add a server/i).first()).toBeVisible();

    // ── Add stdio binding ────────────────────────────────────────────────
    await page.getByRole('button', { name: /add server|add mcp server/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Default transport is stdio — fill server name + catalog id
    await page.getByLabel(/server name/i).fill('fs');
    await page.getByLabel(/catalog entry|catalog id/i).selectOption('filesystem');

    await page.getByRole('button', { name: /^save$|create binding/i }).last().click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

    // Binding shows up in the list
    await expect(page.getByText('fs').first()).toBeVisible();
    await expect(page.getByText(/stdio/i).first()).toBeVisible();

    // ── Add HTTP binding ─────────────────────────────────────────────────
    await page.getByRole('button', { name: /add server|add mcp server/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel(/server name/i).fill('analytics');
    await page.getByRole('radio', { name: /^http$/i }).click();
    await page.getByLabel(/^url$/i).fill('https://api.example.com/mcp');

    // Step 5 added a three-way Authentication radio (None / Static headers /
    // OAuth). Default is None, so pick Static headers before adding rows.
    await page.getByRole('radio', { name: /^static headers$/i }).click();

    // One header row
    await page.getByRole('button', { name: /add header/i }).click();
    await page.getByLabel(/header key 1|header name 1/i).fill('Authorization');
    await page.getByLabel(/header value 1/i).fill('Bearer {{SECRET:ANALYTICS_TOKEN}}');

    await page.getByRole('button', { name: /^save$|create binding/i }).last().click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

    await expect(page.getByText('analytics').first()).toBeVisible();
    await expect(page.getByText(/http/i).first()).toBeVisible();

    // ── Delete stdio binding ─────────────────────────────────────────────
    await page.getByRole('button', { name: 'Remove fs' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /^(delete|confirm|remove)/i }).last().click();

    await expect(page.getByRole('button', { name: 'Remove fs' })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Remove analytics' })).toBeVisible();

    // ── Reload confirms http binding persists ─────────────────────────────
    await page.reload();
    await expect(page.getByRole('heading', { name: /mcp servers/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Remove analytics' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove fs' })).toHaveCount(0);

    // ── Cleanup — remove the persisted analytics binding so the test is rerunnable ──
    await page.getByRole('button', { name: 'Remove analytics' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /^(delete|confirm|remove)/i }).last().click();
  });
});
