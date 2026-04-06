import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Agent Oversight Journey', () => {
  test('agents page shows catalog, run history, and detail navigation', async ({ page }, testInfo) => {
    test.setTimeout(60_000); // multiple navigations with async API loading
    await setupRecording(page, 'agent-catalog-and-history', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/agents`);
    await expect(page.getByText('Available AI agents for building workflows')).toBeVisible({ timeout: 10_000 });

    // Plugin catalog — wait for search bar (appears only when catalog has loaded)
    await expect(page.getByPlaceholder(/search agents/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Risk Detection')).toBeVisible();
    await expect(page.getByText('Input').first()).toBeVisible();
    await expect(page.getByText('Output').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'New Agent', exact: true })).toBeVisible();
    await showStep(page);

    // Switch to Run History tab
    await click(page, page.getByRole('tab', { name: 'Run History' }));
    await expect(page.getByText('Narrative Summary').first()).toBeVisible({ timeout: 10_000 });

    // Autonomy column and badges
    await expect(page.getByRole('columnheader', { name: 'Autonomy' })).toBeVisible();
    await expect(page.getByText('L2').first()).toBeVisible();
    await expect(page.getByText('L4').first()).toBeVisible();

    // Link to detail page
    const link = page.locator('a[href*="/agents/run-completed-1"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /\/agents\/run-completed-1/);
    await showStep(page);

    // Navigate to agent run detail by clicking the link
    await click(page, link);
    await page.waitForURL(`**/${TEST_ORG_HANDLE}/agents/run-completed-1`, { timeout: 20_000 });
    await expect(page.getByText('openrouter/anthropic/claude-sonnet-4').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('92%').first()).toBeVisible();
    await expect(page.getByText('Reviewed 12 vendor submissions')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Routine review of 12 well-structured vendor submissions')).toBeVisible();
    await expect(page.getByText('Supply Chain Review')).toBeVisible();
    await expect(page.getByText('Narrative Summary')).toBeVisible();
    await showStep(page);

    // Output section
    await expect(page.getByRole('button', { name: 'Output', exact: true })).toBeVisible();
    await expect(page.getByText('recommendation')).toBeVisible();
    await expect(page.getByText('continue')).toBeVisible();
    await showResult(page);
  });

  test('escalated run shows low confidence rationale', async ({ page }, testInfo) => {
    await setupRecording(page, 'agent-escalated-run', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/agents/run-escalated-1`);
    await expect(page.getByText('Multiple data inconsistencies in lab values')).toBeVisible({ timeout: 10_000 });
    await showResult(page);
  });

  test('create a new agent and verify redirect', async ({ page }, testInfo) => {
    await setupRecording(page, 'agent-new-form', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/agents`);
    await expect(page.getByText('Available AI agents for building workflows')).toBeVisible({ timeout: 10_000 });
    await click(page, page.getByRole('link', { name: 'New Agent', exact: true }));
    await page.waitForURL(`**/${TEST_ORG_HANDLE}/agents/new`, { timeout: 20_000 });
    await expect(page.getByText('Register a new AI agent and configure its capabilities.')).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Fill in agent details
    await page.getByPlaceholder(/e\.g\. Risk Analysis Agent/i).fill('Test Audit Agent');
    await showStep(page);

    // Verify form is interactive — save button exists (may be disabled until all fields filled)
    await expect(page.getByRole('button', { name: /save new agent/i })).toBeVisible();
    await showResult(page);
    await endRecording(page);
  });
});
