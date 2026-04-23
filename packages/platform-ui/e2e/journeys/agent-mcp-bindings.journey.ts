import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

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
  test('add stdio + http bindings, delete stdio, reload confirms http persists', async ({ page }, testInfo) => {
    await setupRecording(page, 'agent-mcp-bindings', testInfo);

    await page.goto(`/${TEST_ORG_HANDLE}/agents/definitions/claude-code-agent`);
    await expect(page.getByText(/edit this ai agent/i)).toBeVisible({ timeout: 15_000 });

    // MCP Servers section visible (any kind — no warning copy)
    const mcpHeading = page.getByRole('heading', { name: /mcp servers/i });
    await expect(mcpHeading).toBeVisible();
    await expect(page.getByText(/no mcp bindings yet|add a server/i).first()).toBeVisible();
    await showStep(page);

    // ── Add stdio binding ────────────────────────────────────────────────
    await click(page, page.getByRole('button', { name: /add server|add mcp server/i }).first());
    await expect(page.getByRole('dialog')).toBeVisible();

    // Default transport is stdio — fill server name + catalog id
    await page.getByLabel(/server name/i).fill('fs');
    await page.getByLabel(/catalog entry|catalog id/i).selectOption('filesystem');
    await showStep(page);

    await click(page, page.getByRole('button', { name: /^save$|create binding/i }).last());
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

    // Binding shows up in the list
    await expect(page.getByText('fs').first()).toBeVisible();
    await expect(page.getByText(/stdio/i).first()).toBeVisible();
    await showStep(page);

    // ── Add HTTP binding ─────────────────────────────────────────────────
    await click(page, page.getByRole('button', { name: /add server|add mcp server/i }).first());
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel(/server name/i).fill('analytics');
    await click(page, page.getByRole('radio', { name: /^http$/i }));
    await page.getByLabel(/^url$/i).fill('https://api.example.com/mcp');

    // One header row
    await click(page, page.getByRole('button', { name: /add header/i }));
    await page.getByLabel(/header key 1|header name 1/i).fill('Authorization');
    await page.getByLabel(/header value 1/i).fill('Bearer {{SECRET:ANALYTICS_TOKEN}}');
    await showStep(page);

    await click(page, page.getByRole('button', { name: /^save$|create binding/i }).last());
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

    await expect(page.getByText('analytics').first()).toBeVisible();
    await expect(page.getByText(/http/i).first()).toBeVisible();
    await showStep(page);

    // ── Delete stdio binding ─────────────────────────────────────────────
    await click(page, page.getByRole('button', { name: 'Remove fs' }));
    await expect(page.getByRole('dialog')).toBeVisible();
    await click(page, page.getByRole('button', { name: /^(delete|confirm|remove)/i }).last());

    await expect(page.getByRole('button', { name: 'Remove fs' })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Remove analytics' })).toBeVisible();
    await showStep(page);

    // ── Reload confirms http binding persists ─────────────────────────────
    await page.reload();
    await expect(page.getByRole('heading', { name: /mcp servers/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Remove analytics' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove fs' })).toHaveCount(0);
    await showResult(page);

    // ── Cleanup — remove the persisted analytics binding so the test is rerunnable ──
    await click(page, page.getByRole('button', { name: 'Remove analytics' }));
    await expect(page.getByRole('dialog')).toBeVisible();
    await click(page, page.getByRole('button', { name: /^(delete|confirm|remove)/i }).last());

    await endRecording(page);
  });
});
