import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

test.describe('Monitoring Journey', () => {
  test('monitoring page mounts tabs and calls the headless summary + tasks endpoints', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    trackPageErrors(page);

    // ADR-0006 §4 NICE LIVE: the summary endpoint feeds the Workflows tab's
    // status cards. Lock in that the page actually calls it (rather than
    // silently falling back to legacy paths). Race the request against the
    // navigation so the listener is armed before the request fires.
    const summaryRequest = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/namespaces/${TEST_ORG_HANDLE}/monitoring/summary`) &&
        res.request().method() === 'GET',
      { timeout: 30_000 },
    );

    await page.goto(`/${TEST_ORG_HANDLE}/monitoring`);

    // All five tab triggers render.
    for (const label of ['Agents', 'Users', 'Workflows', 'Tasks', 'Integrations']) {
      await expect(page.getByRole('tab', { name: label })).toBeVisible({ timeout: 30_000 });
    }

    const summaryRes = await summaryRequest;
    expect(summaryRes.status()).toBe(200);
    const summaryBody = await summaryRes.json();
    // Compact shape check — no count asserts, since parallel journeys cancel /
    // archive instances under the shared `test` namespace.
    expect(summaryBody).toHaveProperty('summary.runs.running');
    expect(summaryBody).toHaveProperty('summary.runs.paused');
    expect(summaryBody).toHaveProperty('summary.runs.failed');
    expect(summaryBody).toHaveProperty('summary.runs.completed');
    expect(summaryBody).toHaveProperty('summary.tasks.pending');
    expect(summaryBody).toHaveProperty('summary.tasks.claimed');

    // Agents is the default active tab now — switch to Workflows to check its
    // status cards render from the summary response, proving
    // `MonitoringSummaryCards` mounted with the data `useMonitoringData` delivered.
    await page.getByRole('tab', { name: 'Workflows' }).click();
    await expect(
      page.getByRole('heading', { name: 'Status overview' }),
    ).toBeVisible();
    await expect(page.getByText('Running', { exact: true })).toBeVisible();
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();
    await expect(page.getByText('Failed', { exact: true })).toBeVisible();
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();

    // Tasks tab reads the same `useMonitoringData` hook via the workspace-
    // scoped `tasks.list({ namespace })` call — switch and confirm it mounts.
    await page.getByRole('tab', { name: 'Tasks' }).click();
    await expect(page.getByRole('heading', { name: 'By role' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'By assignee' })).toBeVisible();
  });

  test('Users tab shows real, workspace-wide user activity — not mocked data', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/monitoring`);
    await page.getByRole('tab', { name: 'Users' }).click();

    for (const header of ['Date & Time', 'User', 'Event', 'Details']) {
      await expect(page.getByRole('columnheader', { name: header })).toBeVisible({ timeout: 10_000 });
    }

    // Scoped to the table body throughout — the filter dropdowns added below
    // also render options labelled "Sign in" / "Task completed" etc., which
    // would otherwise collide with a page-wide getByText.
    const rows = page.locator('tbody');

    // All four event types the table understands, each backed by a real
    // seeded audit_events row (see seed-data.ts's audit-signin-*,
    // audit-workflow-*, audit-task-completed fixtures).
    await expect(rows.getByText('Sign in').first()).toBeVisible({ timeout: 10_000 });
    await expect(rows.getByText('Workflow triggered')).toBeVisible();
    await expect(rows.getByText('Workflow cancelled')).toBeVisible();
    await expect(rows.getByText('Task completed')).toBeVisible();

    // Details resolve real data, not placeholders: IP for password sign-in,
    // provider for OAuth sign-in, the actual workflow name (joined via
    // useProcessNameMap), and the formatted step name.
    await expect(rows.getByText('IP 203.0.113.42')).toBeVisible();
    await expect(rows.getByText('Signed in via google (SSO)')).toBeVisible();
    await expect(rows.getByText('Supply Chain Review')).toBeVisible();
    await expect(rows.getByText('Data Quality Review')).toBeVisible();
    await expect(rows.getByText('Manager Approval')).toBeVisible();

    // Event-type filter actually narrows the rendered table, not just the
    // dropdown's own state. First combobox is the User filter, second is
    // Event.
    const eventFilter = page.getByRole('combobox').nth(1);
    await eventFilter.selectOption({ label: 'Task completed' });
    await expect(rows.getByText('Manager Approval')).toBeVisible();
    await expect(rows.getByText('Supply Chain Review')).not.toBeVisible();
    await expect(rows.getByText('Sign in')).not.toBeVisible();
    await eventFilter.selectOption({ label: 'All Events' });
  });
});
