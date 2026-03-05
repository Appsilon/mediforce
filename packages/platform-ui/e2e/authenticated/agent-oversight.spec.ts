import { test, expect } from '@playwright/test';

// Uses seeded data from auth-setup.ts:
// - agentRuns: run-completed-1 (narrative-summary, proc-running-1, completed, confidence 0.92)
//              run-escalated-1 (data-quality, proc-paused-1, escalated, confidence 0.45)
//              run-running-1 (protocol-deviation, proc-running-1, running, no envelope)
// - processInstances: proc-running-1 (Supply Chain Review), proc-paused-1 (Supply Chain Review)

test.describe('Agent Oversight', () => {
  test('Agent Oversight page loads and shows heading', async ({ page }) => {
    await page.goto('/agents');
    await expect(
      page.getByRole('heading', { name: 'Agent Oversight' }),
    ).toBeVisible();
  });

  test('Agent Oversight page shows seeded agent runs', async ({ page }) => {
    await page.goto('/agents');
    // The table should have at least one row with the narrative-summary pluginId
    await expect(page.getByText('narrative-summary').first()).toBeVisible();
  });

  test('Agent Oversight page shows agent runs count', async ({ page }) => {
    await page.goto('/agents');
    // The subtitle shows "N agent runs" after data loads
    await expect(page.getByText(/\d+ agent runs/)).toBeVisible({ timeout: 10_000 });
  });

  test('Agent run detail page shows model and confidence', async ({ page }) => {
    await page.goto('/agents/run-completed-1');
    // Model text should be visible
    await expect(
      page.getByText('openrouter/anthropic/claude-sonnet-4'),
    ).toBeVisible();
    // Confidence 92% should be visible (first instance is in the header)
    await expect(page.getByText('92%').first()).toBeVisible();
    // Reasoning summary should be partially visible
    await expect(
      page.getByText('Reviewed 12 vendor submissions'),
    ).toBeVisible();
  });

  test('Agent run detail page shows process name', async ({ page }) => {
    await page.goto('/agents/run-completed-1');
    // Process definition name from proc-running-1
    await expect(page.getByText('Supply Chain Review')).toBeVisible();
  });

  test('Agent run detail page shows human-readable step name', async ({ page }) => {
    await page.goto('/agents/run-completed-1');
    // stepId "narrative-summary" should be formatted as "Narrative Summary"
    await expect(page.getByText('Narrative Summary')).toBeVisible();
  });

  test('Agent run detail page shows output section with result data', async ({ page }) => {
    await page.goto('/agents/run-completed-1');
    // The Output section heading should be visible (use exact match to avoid matching "Input (Previous Step Output)")
    await expect(
      page.getByRole('button', { name: 'Output', exact: true }),
    ).toBeVisible();
    // Check for a key from the result object (flat field rendered in table)
    await expect(page.getByText('recommendation')).toBeVisible();
    await expect(page.getByText('continue')).toBeVisible();
  });

  test('[DATA] Autonomy column shows level badges', async ({ page }) => {
    await page.goto('/agents');
    // Verify the table has an 'Autonomy' column header
    await expect(
      page.getByRole('columnheader', { name: 'Autonomy' }),
    ).toBeVisible({ timeout: 10_000 });
    // Verify at least one row shows 'L2' badge text (run-completed-1 has L2)
    await expect(page.getByText('L2').first()).toBeVisible({ timeout: 10_000 });
    // Verify at least one row shows 'L4' badge text (run-l4-autopilot has L4)
    await expect(page.getByText('L4').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Agent list has links to detail pages', async ({ page }) => {
    await page.goto('/agents');
    // Wait for table to load with seeded data
    const link = page.locator('a[href="/agents/run-completed-1"]');
    await expect(link).toBeVisible();
    // Verify the link has the correct href pointing to the detail page
    await expect(link).toHaveAttribute('href', '/agents/run-completed-1');
    // Verify the link text is the pluginId
    await expect(link).toHaveText('narrative-summary');
  });
});
