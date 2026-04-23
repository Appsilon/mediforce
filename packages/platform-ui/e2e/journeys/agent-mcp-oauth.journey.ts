import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

/**
 * Journey 4 — Agent MCP OAuth (Step 5)
 *
 * Admin sees a seeded OAuth provider (`github-mock` — pointed at the mock
 * OAuth server started by playwright globalSetup). The user then opens the
 * pre-configured `oauth-test-agent` which ships with one HTTP MCP binding
 * bound to `github-mock`. They exercise the full Connect / Disconnect /
 * Reconnect / Revoke cycle:
 *
 *  1. `/admin/oauth-providers` lists the GitHub (mock) provider.
 *  2. `/agents/definitions/oauth-test-agent` shows the OAuth binding in the
 *     MCP section with a Connect button.
 *  3. Clicking Connect navigates to the provider `/authorize`, which 302s
 *     back to `/api/oauth/github-mock/callback?code=…&state=…`, which 302s
 *     to the agent page with `?connected=github-mcp`. The binding row
 *     now shows "Connected as @mock-user".
 *  4. Disconnect (local-only) flips back to "Not connected".
 *  5. Reconnect — same redirect chain, same final state.
 *  6. Revoke opens a confirm dialog; confirming hits the provider's
 *     `/revoke` endpoint (mock counts the hit) and flips back to
 *     "Not connected".
 *
 * The fixture agent + provider live in `e2e/helpers/seed-data.ts`. The mock
 * OAuth server lives in `e2e/helpers/mock-oauth-server.ts` and its base URL
 * is written into Firestore at auth-setup time so the provider config
 * points at the live port.
 */

test.describe('Agent MCP OAuth Journey', () => {
  test('connect, disconnect, reconnect, revoke via mock provider', async ({ page }, testInfo) => {
    await setupRecording(page, 'agent-mcp-oauth', testInfo);

    // ── Admin view: provider is listed ───────────────────────────────────
    await page.goto(`/${TEST_ORG_HANDLE}/admin/oauth-providers`);
    await expect(page.getByRole('heading', { name: /oauth providers/i })).toBeVisible({
      timeout: 15_000,
    });
    // The seeded `github-mock` provider should be in the list. It renders
    // with doc id as code and display name beside it.
    await expect(page.getByText('github-mock').first()).toBeVisible();
    await expect(page.getByText(/github \(mock\)/i).first()).toBeVisible();
    await showStep(page);

    // ── Open the fixture agent with the pre-bound OAuth binding ──────────
    await page.goto(`/${TEST_ORG_HANDLE}/agents/definitions/oauth-test-agent`);
    await expect(page.getByText(/edit this ai agent/i)).toBeVisible({ timeout: 15_000 });

    const mcpHeading = page.getByRole('heading', { name: /mcp servers/i });
    await expect(mcpHeading).toBeVisible();
    // The seeded binding name is `github-mcp`.
    await expect(page.getByText('github-mcp').first()).toBeVisible();
    await showStep(page);

    // ── Connect ───────────────────────────────────────────────────────────
    // `window.location = authorizeUrl` inside the Connect handler triggers
    // a full-page redirect to the mock `/authorize` endpoint, which
    // immediately 302s back to `/api/oauth/github-mock/callback?...`,
    // which 302s to the agent page with `?connected=github-mcp`.
    await click(page, page.getByRole('button', { name: /^connect$/i }).first());
    await page.waitForURL(/\?connected=github-mcp/, { timeout: 20_000 });
    await expect(page.getByText(/connected as @mock-user|connected: @mock-user|@mock-user/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await showStep(page);

    // ── Disconnect (local only) ──────────────────────────────────────────
    await click(page, page.getByRole('button', { name: /^disconnect$/i }).first());
    // UI either re-renders immediately or after a server round-trip.
    await expect(page.getByRole('button', { name: /^connect$/i }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/@mock-user/i)).toHaveCount(0);
    await showStep(page);

    // ── Reconnect ────────────────────────────────────────────────────────
    await click(page, page.getByRole('button', { name: /^connect$/i }).first());
    await page.waitForURL(/\?connected=github-mcp/, { timeout: 20_000 });
    await expect(page.getByText(/@mock-user/i).first()).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // ── Revoke (local + provider) ────────────────────────────────────────
    // Revoke is destructive — confirm dialog, then provider `/revoke` is
    // POSTed, then local token deleted. The mock /revoke returns 200, so
    // the UI should return to "Not connected" without surfacing an error.
    await click(page, page.getByRole('button', { name: /^revoke$/i }).first());
    await expect(page.getByRole('dialog')).toBeVisible();
    await click(page, page.getByRole('button', { name: /^(revoke|confirm)$/i }).last());

    await expect(page.getByRole('button', { name: /^connect$/i }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/@mock-user/i)).toHaveCount(0);
    await showResult(page);

    await endRecording(page);
  });
});
