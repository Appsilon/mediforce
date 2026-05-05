import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

/**
 * Journey — GitHub MCP preset
 *
 * One-click "Add GitHub MCP" preset on the agent MCP bindings panel pre-fills
 * an HTTP binding pointing at `https://api.githubcopilot.com/mcp/` with OAuth
 * auth. The preset references a provider id of `github`, which doesn't exist
 * in the e2e seed (we only seed `github-mock`); the test verifies the pre-fill
 * is correct, then switches the provider to `github-mock` to complete a real
 * save against the local mock OAuth server. Binding is cleaned up at the end
 * so the test is rerunnable.
 */

test.describe('GitHub MCP preset journey', () => {
  test('one-click "Add GitHub MCP" pre-fills HTTP + OAuth binding', async ({ page }, testInfo) => {
    await setupRecording(page, 'github-mcp-preset', testInfo);

    await page.goto(`/${TEST_ORG_HANDLE}/agents/definitions/claude-code-agent`);
    await expect(page.getByText(/edit this ai agent/i)).toBeVisible({ timeout: 30_000 });

    const mcpHeading = page.getByRole('heading', { name: /mcp servers/i });
    await expect(mcpHeading).toBeVisible();
    await showStep(page);

    // ── Click "Add GitHub MCP" preset ────────────────────────────────────
    await click(page, page.getByRole('button', { name: /add github mcp/i }));
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: /add github mcp server/i })).toBeVisible();

    // Pre-fills — server name, transport, URL, OAuth auth mode
    await expect(page.getByLabel(/server name/i)).toHaveValue('github');
    await expect(page.getByRole('radio', { name: /^http$/i })).toBeChecked();
    await expect(page.getByLabel(/^url$/i)).toHaveValue('https://api.githubcopilot.com/mcp/');
    await expect(page.getByRole('radio', { name: /^oauth$/i })).toBeChecked();
    await showStep(page);

    // ── Switch provider to the e2e mock and save ─────────────────────────
    // The preset references provider id `github` (real GitHub). The e2e env
    // only has `github-mock` seeded for OAuth flow testing, so swap before
    // saving.
    await page.getByLabel(/oauth provider/i).selectOption({ label: 'GitHub (mock)' });

    await click(page, page.getByRole('button', { name: /^save$|create binding/i }).last());
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

    // Binding row appears
    await expect(page.getByText('github').first()).toBeVisible();
    await expect(page.getByText(/http/i).first()).toBeVisible();
    await showResult(page);

    // ── Cleanup so the test is rerunnable ────────────────────────────────
    await click(page, page.getByRole('button', { name: 'Remove github' }));
    await expect(page.getByRole('dialog')).toBeVisible();
    await click(page, page.getByRole('button', { name: /^(delete|confirm|remove)/i }).last());

    await endRecording(page);
  });
});
