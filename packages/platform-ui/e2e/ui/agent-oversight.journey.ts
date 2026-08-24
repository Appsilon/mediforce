import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { RUN_COMPLETED_1_ID, RUN_ESCALATED_1_ID } from '../helpers/seed-data';
import { trackPageErrors } from '../helpers/page-errors';

test.describe('Agent Oversight Journey', () => {
  test('agents page shows catalog, run history, and detail navigation', async ({ page }) => {
    test.setTimeout(60_000); // multiple navigations with async API loading
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/agents`);
    await expect(page.getByText('Custom Agents')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Reusable agent configurations that workflow steps call by id')).toBeVisible();
    await expect(
      page.getByText(/An agent is a reusable configuration a workflow step calls by id/),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'New Agent', exact: true })).toBeVisible();

    // Run history lives on Monitoring → Agents, not on the Agents catalog page.
    await page.goto(`/${TEST_ORG_HANDLE}/monitoring`);
    await page.getByRole('tab', { name: 'Agents' }).click();
    await expect(page.getByText('Narrative Summary').first()).toBeVisible({ timeout: 10_000 });

    // Control Mode column shows control mode labels, not raw L-level codes
    await expect(page.getByRole('columnheader', { name: 'Control Mode' })).toBeVisible();
    await expect(page.getByText('Assist').first()).toBeVisible();
    await expect(page.getByText('Autonomous agent').first()).toBeVisible();

    // Link to detail page
    const link = page.locator(`a[href*="/agents/${RUN_COMPLETED_1_ID}"]`);

    // Workflow Run column, same row: links to the actual run detail page
    // (workflow name + runId), not a bare processInstanceId path.
    const row = page.locator('tr', { has: link });
    const workflowRunLink = row.locator('a', { hasText: 'Supply Chain Review' });
    await expect(workflowRunLink).toHaveAttribute(
      'href',
      `/${TEST_ORG_HANDLE}/workflows/${encodeURIComponent('Supply Chain Review')}/runs/proc-running-1`,
    );
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', new RegExp(`/agents/${RUN_COMPLETED_1_ID}`));

    // Permissions column: real tool grant read from the step's config in
    // the process instance's pinned workflow-definition version (a live
    // join via mediforce.processes.getSteps), not a hardcoded display.
    await expect(row.getByText('WebFetch')).toBeVisible({ timeout: 10_000 });

    // Log column: clicking "View" expands the right panel with the real
    // execution log (seeded via an agent activity log AgentEvent + a fixture
    // file on disk — the same pipeline a live run uses, not a mocked panel).
    await row.getByRole('button', { name: 'View' }).click();
    await expect(page.getByText('Agent Log')).toBeVisible();
    await expect(page.getByText('Reviewed 12 vendor submissions. No issues detected.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('grep -c missing vendor-submissions.csv')).toBeVisible();
    await page.getByTitle('Close panel').click();

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

  test('create a new agent with only a name and a model', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/agents`);
    await expect(page.getByText('Custom Agents')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('link', { name: 'New Agent', exact: true }).click();
    await page.waitForURL(`**/${TEST_ORG_HANDLE}/agents/new`, { timeout: 20_000 });
    await expect(
      page.getByText(/An agent is a reusable configuration workflow steps call by id/),
    ).toBeVisible({ timeout: 10_000 });

    // Agents accumulate across runs against a shared database, so the name has
    // to be unique or the catalog assertion matches an earlier run's card.
    const agentName = `Test Audit Agent ${Date.now()}`;

    // Name and foundation model are the only required fields; everything else
    // is left empty on purpose.
    await page.getByPlaceholder(/e\.g\. Risk Analysis Agent/i).fill(agentName);
    await page.getByRole('button', { name: /select a model/i }).click();
    await page.getByRole('button', { name: /claude sonnet 4/i }).click();

    await page.getByRole('button', { name: /save new agent/i }).click();

    // Creating lands on the new agent's Configure page — MCP servers can only
    // be bound once the agent is persisted, so that is where the flow continues.
    await page.waitForURL(`**/${TEST_ORG_HANDLE}/agents/definitions/**`, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'MCP Servers' })).toBeVisible({ timeout: 20_000 });

    // The created agent is scoped to the current workspace, so it also shows up
    // in the catalog.
    await page.goto(`/${TEST_ORG_HANDLE}/agents`);
    await expect(page.getByRole('heading', { name: agentName })).toBeVisible({ timeout: 10_000 });
  });
});
