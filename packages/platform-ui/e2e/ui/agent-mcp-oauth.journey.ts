import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { deletePostgresAgentOAuthToken } from '../helpers/postgres-seed';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

const OAUTH_AGENT_ID = 'oauth-test-agent';
const OAUTH_SERVER_NAME = 'github-mcp';

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
 * is seeded into the `oauth_providers` Postgres row at auth-setup time so the
 * provider config points at the live port.
 */

test.describe('Agent MCP OAuth Journey', () => {
  test('connect, disconnect, reconnect, revoke via mock provider', async ({ page }, testInfo) => {
    await setupRecording(page, 'agent-mcp-oauth', testInfo);

    // Playwright re-runs the full test on retry, but `auth-setup` runs once
    // globally — so a token written by an earlier failed attempt would still
    // be in Postgres here. That makes the binding row render "Connected as
    // @mock-user" before any user action, with no Connect button to click.
    // Delete any leftover `agent_oauth_tokens` row to make this journey
    // idempotent across retries.
    await deletePostgresAgentOAuthToken(TEST_ORG_HANDLE, OAUTH_AGENT_ID, OAUTH_SERVER_NAME);

    // ── Admin view: provider is listed ───────────────────────────────────
    await page.goto(`/${TEST_ORG_HANDLE}/admin/oauth-providers`);
    await expect(page.getByRole('heading', { name: /oauth providers/i })).toBeVisible({
      timeout: 30_000,
    });
    // The seeded `github-mock` provider should be in the list. It renders
    // with doc id as code and display name beside it. Cold compile + data
    // fetch on first hit can exceed Playwright's 5s default — give it room.
    await expect(page.getByText('github-mock').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/github \(mock\)/i).first()).toBeVisible();
    await showStep(page);

    // ── Open the fixture agent with the pre-bound OAuth binding ──────────
    await page.goto(`/${TEST_ORG_HANDLE}/agents/definitions/${OAUTH_AGENT_ID}`);
    await expect(page.getByText(/edit this ai agent/i)).toBeVisible({ timeout: 15_000 });

    const mcpHeading = page.getByRole('heading', { name: /mcp servers/i });
    await expect(mcpHeading).toBeVisible();
    // The seeded binding name is `github-mcp`.
    await expect(page.getByText(OAUTH_SERVER_NAME).first()).toBeVisible();
    // Wait for OAuthConnectionStatus to finish its initial token-list fetch
    // before clicking Connect — otherwise the click locator races against
    // the "Checking connection…" placeholder. The "Not connected" label
    // proves listAgentOAuthTokens resolved with no token (clean state).
    await expect(page.getByText(/not connected/i).first()).toBeVisible({ timeout: 15_000 });
    await showStep(page);

    // ── Connect ───────────────────────────────────────────────────────────
    // `window.location = authorizeUrl` inside the Connect handler triggers
    // a full-page redirect to the mock `/authorize` endpoint, which
    // immediately 302s back to `/api/oauth/github-mock/callback?...`,
    // which 302s to the agent page with `?connected=github-mcp`.
    await click(page, page.getByRole('button', { name: /^connect$/i }).first());
    await page.waitForURL(/\?connected=github-mcp/, { timeout: 20_000 });
    // After the hard navigation back, the OAuthConnectionStatus component
    // re-mounts in `loading` state and refetches the token list. Wait for
    // the loading placeholder to clear before asserting on the connected
    // label, otherwise a slow refetch (cold route compile, contended
    // emulator) eats the 10s window.
    await expect(page.getByText(/checking connection/i)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/connected as @mock-user|connected: @mock-user|@mock-user/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await showStep(page);

    // ── Disconnect (local only) ──────────────────────────────────────────
    await click(page, page.getByRole('button', { name: /^disconnect$/i }).first());
    // UI either re-renders immediately or after a server round-trip. Wait
    // for the loading placeholder triggered by `refresh()` to clear before
    // asserting on the post-disconnect state.
    await expect(page.getByText(/checking connection/i)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/not connected/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /^connect$/i }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/@mock-user/i)).toHaveCount(0);
    await showStep(page);

    // ── Reconnect ────────────────────────────────────────────────────────
    await click(page, page.getByRole('button', { name: /^connect$/i }).first());
    await page.waitForURL(/\?connected=github-mcp/, { timeout: 20_000 });
    await expect(page.getByText(/checking connection/i)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/@mock-user/i).first()).toBeVisible({ timeout: 15_000 });
    await showStep(page);

    // ── Revoke (local + provider) ────────────────────────────────────────
    // Revoke is destructive — confirm dialog, then provider `/revoke` is
    // POSTed, then local token deleted. The mock /revoke returns 200, so
    // the UI should return to "Not connected" without surfacing an error.
    await click(page, page.getByRole('button', { name: /^revoke$/i }).first());
    await expect(page.getByRole('dialog')).toBeVisible();
    await click(page, page.getByRole('button', { name: /^(revoke|confirm)$/i }).last());

    await expect(page.getByText(/checking connection/i)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: /^connect$/i }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/@mock-user/i)).toHaveCount(0);
    await showResult(page);

    await endRecording(page);
  });
});
