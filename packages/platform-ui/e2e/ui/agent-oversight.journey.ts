import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { RUN_COMPLETED_1_ID, RUN_ESCALATED_1_ID } from '../helpers/seed-data';
import { trackPageErrors } from '../helpers/page-errors';

test.describe('Agent Oversight Journey', () => {
  test('agents page shows catalog, run history, and detail navigation', async ({ page }) => {
    test.setTimeout(60_000); // multiple navigations with async API loading
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/agents`);
    await expect(page.getByText('Available AI agents for building workflows')).toBeVisible({ timeout: 10_000 });

    // "Available Agents" tab is the default — wait for the Run History tab to be
    // present, which confirms the page shell rendered. The catalog content depends
    // on plugin infrastructure that may not be present in emulator mode, so we
    // don't assert on specific catalog items here.
    await expect(page.getByRole('tab', { name: 'Run History' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: 'New Agent', exact: true })).toBeVisible();

    // Switch to Run History tab
    await page.getByRole('tab', { name: 'Run History' }).click();
    await expect(page.getByText('Narrative Summary').first()).toBeVisible({ timeout: 10_000 });

    // Autonomy column shows control mode labels, not raw L-level codes
    await expect(page.getByRole('columnheader', { name: 'Autonomy' })).toBeVisible();
    await expect(page.getByText('Assist').first()).toBeVisible();
    await expect(page.getByText('Autonomous agent').first()).toBeVisible();

    // Link to detail page
    const link = page.locator(`a[href*="/agents/${RUN_COMPLETED_1_ID}"]`);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', new RegExp(`/agents/${RUN_COMPLETED_1_ID}`));

    // Navigate to agent run detail by clicking the link
    await link.click();
    await page.waitForURL(`**/${TEST_ORG_HANDLE}/agents/${RUN_COMPLETED_1_ID}`, { timeout: 20_000 });
    await expect(page.getByText('openrouter/anthropic/claude-sonnet-4').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('92%').first()).toBeVisible();
    await expect(page.getByText('Reviewed 12 vendor submissions')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Routine review of 12 well-structured vendor submissions')).toBeVisible();
    await expect(page.getByText('Supply Chain Review')).toBeVisible();
    await expect(page.getByText('Narrative Summary')).toBeVisible();

    // Output section
    await expect(page.getByRole('button', { name: 'Output', exact: true })).toBeVisible();
    await expect(page.getByText('recommendation')).toBeVisible();
    await expect(page.getByText('continue')).toBeVisible();
  });

  test('escalated run shows low confidence rationale', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/agents/${RUN_ESCALATED_1_ID}`);
    await expect(page.getByText('Multiple data inconsistencies in lab values')).toBeVisible({ timeout: 10_000 });
  });

  test('create a new agent and verify redirect', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/agents`);
    await expect(page.getByText('Available AI agents for building workflows')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('link', { name: 'New Agent', exact: true }).click();
    await page.waitForURL(`**/${TEST_ORG_HANDLE}/agents/new`, { timeout: 20_000 });
    await expect(page.getByText('Register a new AI agent and configure its capabilities.')).toBeVisible({ timeout: 10_000 });

    // Fill in agent details
    await page.getByPlaceholder(/e\.g\. Risk Analysis Agent/i).fill('Test Audit Agent');

    // Verify form is interactive — save button exists (may be disabled until all fields filled)
    await expect(page.getByRole('button', { name: /save new agent/i })).toBeVisible();
  });
});
