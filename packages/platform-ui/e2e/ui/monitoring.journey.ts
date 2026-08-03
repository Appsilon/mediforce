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

    // Workflows is the default active tab — its KPI cards render from the
    // same getWorkflowStatus-derived labels the runs table's own status
    // badges use (no "Status overview" heading anymore — cards sit directly
    // at the top of the tab).
    await expect(page.getByRole('heading', { name: 'Status overview' })).toHaveCount(0);
    // .first(): the runs table below the KPI cards renders the same words as
    // per-row status badges, so these labels are no longer unique on the
    // page — the KPI cards render first in DOM order.
    await expect(page.getByText('In Progress', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Waiting for human', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Error', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();

    // The "All runs" table + its filters now live in this tab (moved from
    // the standalone /runs page) — the production/dry-run toggle and the
    // runs table itself both render.
    await expect(page.getByRole('button', { name: 'Production' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show archived' })).toBeVisible();

    // Clicking a KPI card filters the table to that status — a "Filtered
    // by" chip appears, and clicking Clear removes it again.
    await page.getByRole('button', { name: /Completed/ }).first().click();
    await expect(page.getByText('Filtered by:')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByText('Filtered by:')).not.toBeVisible();

    // Run ID column is gone; Cost and Started are sortable (clicking
    // doesn't error and flips the header's own sort indicator).
    await expect(page.getByRole('columnheader', { name: 'Run ID' })).toHaveCount(0);
    const costHeader = page.getByRole('button', { name: /^Cost/ });
    await expect(costHeader).toBeVisible();
    await costHeader.click();
    await costHeader.click();
    const startedHeader = page.getByRole('button', { name: /^Started/ });
    await expect(startedHeader).toBeVisible();
    await startedHeader.click();

    // Tasks tab reads the same `useMonitoringData` hook via the workspace-
    // scoped `tasks.list({ namespace })` call — switch and confirm it mounts.
    // "By role" / "By assignee" are gone — replaced by the task activity
    // table (asserted in detail in the next test).
    await page.getByRole('tab', { name: 'Tasks' }).click();
    await expect(page.getByRole('heading', { name: 'By role' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'By assignee' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Task' })).toBeVisible({ timeout: 10_000 });
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
    // would otherwise collide with a page-wide getByText. `.first()`
    // everywhere: this table is namespace-wide and unscoped to this test's
    // own fixtures, so in the full CI suite other journeys running against
    // the same shared `test` namespace add their own matching rows (e.g.
    // other cancelled runs) — these assertions only need to prove the real
    // shape shows up somewhere, not that it's the only occurrence.
    const rows = page.locator('tbody');

    // All four event types the table understands, each backed by a real
    // seeded audit_events row (see seed-data.ts's audit-signin-*,
    // audit-workflow-*, audit-task-completed fixtures).
    await expect(rows.getByText('Sign in').first()).toBeVisible({ timeout: 10_000 });
    await expect(rows.getByText('Workflow triggered').first()).toBeVisible();
    await expect(rows.getByText('Workflow cancelled').first()).toBeVisible();
    await expect(rows.getByText('Task completed').first()).toBeVisible();

    // Details resolve real data, not placeholders: IP for password sign-in,
    // provider for OAuth sign-in, the actual workflow name (joined via
    // useProcessNameMap), and the formatted step name.
    await expect(rows.getByText('IP 203.0.113.42').first()).toBeVisible();
    await expect(rows.getByText('Signed in via google (SSO)').first()).toBeVisible();
    await expect(rows.getByText('Supply Chain Review').first()).toBeVisible();
    await expect(rows.getByText('Data Quality Review').first()).toBeVisible();
    await expect(rows.getByText('Manager Approval').first()).toBeVisible();

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

  test('Tasks tab shows real task activity — not mocked data', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/monitoring`);
    await page.getByRole('tab', { name: 'Tasks' }).click();

    // KPI cards are gone — just the activity table + overdue list now.
    await expect(page.getByText('Open tasks')).toHaveCount(0);
    await expect(page.getByText('Pending (queue)')).toHaveCount(0);

    for (const header of ['Date & Time', 'Task', 'User', 'Action', 'Workflow']) {
      await expect(page.getByRole('columnheader', { name: header })).toBeVisible({ timeout: 10_000 });
    }

    const rows = page.locator('tbody');

    // Two action types, each backed by a real seeded audit_events row (see
    // seed-data.ts's audit-task-claimed / audit-task-completed fixtures).
    // `.first()` on 'Completed': with server-side pagination this table is
    // namespace-wide and unscoped to this test's own fixtures, so the top-20
    // default page can (and, once the Load-More fixture batch below exists,
    // reliably does) contain more than one `task.completed` row — this only
    // needs to prove the badge shows up somewhere, not that it's unique.
    await expect(rows.getByText('Claimed')).toBeVisible({ timeout: 10_000 });
    await expect(rows.getByText('Completed').first()).toBeVisible();

    // "Task" resolves the real step name and links to the real task, not a
    // placeholder — same formatStepName convention as everywhere else.
    const taskLink = rows.getByRole('link', { name: 'Manager Approval' });
    await expect(taskLink).toBeVisible();
    await expect(taskLink).toHaveAttribute('href', `/${TEST_ORG_HANDLE}/tasks/task-manager-approval`);
    await expect(rows.getByRole('link', { name: 'Approve Report' })).toBeVisible();

    // "Workflow" resolves the real run's definition name and links to that
    // specific run — both seeded task events belong to proc-running-1.
    const workflowLinks = rows.getByRole('link', { name: 'Supply Chain Review' });
    await expect(workflowLinks.first()).toBeVisible();
    await expect(workflowLinks.first()).toHaveAttribute(
      'href',
      `/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/runs/proc-running-1`,
    );

    // Action filter narrows the rendered table. First combobox is the User
    // filter, second is Action.
    const actionFilter = page.getByRole('combobox').nth(1);
    await actionFilter.selectOption({ label: 'Completed' });
    await expect(rows.getByText('Manager Approval')).toBeVisible();
    await expect(rows.getByText('Approve Report')).not.toBeVisible();
    await actionFilter.selectOption({ label: 'All Actions' });
  });

  test('Integrations tab lists services without the removed KPI/health/error chrome', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/monitoring`);
    await page.getByRole('tab', { name: 'Integrations' }).click();

    // KPI boxes, the "Services" heading, the "Recent integration errors"
    // section, and per-card "healthy" badges are all gone.
    await expect(page.getByText('Healthy', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Degraded', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Down', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Services' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Recent integration errors' })).toHaveCount(0);

    // The requested services (+ what was found in the codebase) render as
    // cards.
    for (const name of ['Databricks', 'OpenRouter', 'GitHub', 'Mailgun']) {
      await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 10_000 });
    }

    // The mocked-data disclaimer stays, and OpenRouter is called out as the
    // one card backed by a real, live value.
    await expect(page.getByText(/illustrative placeholders/i)).toBeVisible();
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
  });

  test('Agents tab KPI cards filter the run table, matching the Workflows tab pattern', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/monitoring`);
    await page.getByRole('tab', { name: 'Agents' }).click();

    const rows = page.locator('tbody');
    // `data-quality` is only on the seeded escalated run, `compliance-check`
    // only on the seeded running run — a clean pair to prove filtering by
    // status actually narrows rows rather than just toggling chip state.
    await expect(rows.getByText('Data Quality')).toBeVisible({ timeout: 10_000 });
    await expect(rows.getByText('Compliance Check')).toBeVisible();

    await page.getByRole('button', { name: /Running/ }).first().click();
    await expect(page.getByText('Filtered by:')).toBeVisible();
    await expect(rows.getByText('Compliance Check')).toBeVisible();
    await expect(rows.getByText('Data Quality')).not.toBeVisible();

    // Clicking the same card again toggles the filter off.
    await page.getByRole('button', { name: /Running/ }).first().click();
    await expect(page.getByText('Filtered by:')).not.toBeVisible();
    await expect(rows.getByText('Data Quality')).toBeVisible();

    await page.getByRole('button', { name: /Flagged/ }).first().click();
    await expect(rows.getByText('Data Quality')).toBeVisible();
    await expect(rows.getByText('Compliance Check')).not.toBeVisible();

    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByText('Filtered by:')).not.toBeVisible();
    await expect(rows.getByText('Compliance Check')).toBeVisible();
  });

  test('Users tab: Load More grows the table from 20 to 21 rows via a real actor filter, then disappears', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/monitoring`);
    await page.getByRole('tab', { name: 'Users' }).click();

    // 21 dedicated audit events (seed-data.ts's `monitoring-loadmore-actor`
    // batch — one PAGE_SIZE(20) over the limit) isolate exactly by actorId
    // via the tab's own "User" filter (first combobox), so this is an
    // exact assertion, not a lower bound.
    await page.getByRole('combobox').nth(0).selectOption({ value: 'monitoring-loadmore-actor' });

    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(20, { timeout: 10_000 });
    const loadMoreButton = page.getByRole('button', { name: 'Load more' });
    await expect(loadMoreButton).toBeVisible();

    await loadMoreButton.click();
    await expect(rows).toHaveCount(21);
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  });

  test('Tasks tab: Load More grows the table from 20 to 21 rows via a real actor filter, then disappears', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/monitoring`);
    await page.getByRole('tab', { name: 'Tasks' }).click();

    // Same 21-event batch as the Users tab test above — `task.completed`
    // is in both USER_ACTIVITY_ACTIONS and TASK_ACTIVITY_ACTIONS, so one
    // fixture batch proves Load More on both tabs.
    await page.getByRole('combobox').nth(0).selectOption({ value: 'monitoring-loadmore-actor' });

    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(20, { timeout: 10_000 });
    const loadMoreButton = page.getByRole('button', { name: 'Load more' });
    await expect(loadMoreButton).toBeVisible();

    await loadMoreButton.click();
    await expect(rows).toHaveCount(21);
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  });

  test('Agents tab: KPI cards report the true DB count independent of the ≤20 loaded rows, and Load More grows the table', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/monitoring`);
    await page.getByRole('tab', { name: 'Agents' }).click();

    // 21 dedicated agent runs (seed-data.ts's "Monitoring LoadMore Agent
    // Workflow" parent instance), all `running` — isolate exactly via the
    // tab's own "Workflow" filter (first combobox), an exact filter rather
    // than a KPI-bucket lower bound.
    await page.getByRole('combobox').nth(0).selectOption({ label: 'Monitoring LoadMore Agent Workflow' });

    // The whole point of server-side KPI aggregation: the cards show the
    // real count of the filtered set (21), not a tally of the ≤20 rows
    // rendered in the table below them.
    await expect(page.getByRole('button', { name: /Total runs/ }).first()).toContainText('21', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: /Running/ }).first()).toContainText('21');
    await expect(page.getByRole('button', { name: /Completed/ }).first()).toContainText('0');
    await expect(page.getByText('20 of 21 runs')).toBeVisible();

    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(20);
    const loadMoreButton = page.getByRole('button', { name: 'Load more' });
    await expect(loadMoreButton).toBeVisible();

    await loadMoreButton.click();
    await expect(rows).toHaveCount(21);
    await expect(page.getByText('21 of 21 runs')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  });

  test('Workflows tab: KPI cards report the true DB count, and Load More grows the table from 20 to 21 rows', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/monitoring`);

    // 21 dedicated dry runs (seed-data.ts's "Workflows LoadMore Dry Run
    // Workflow" batch) — the Workflows tab has no per-workflow filter of its
    // own, but no other fixture or journey creates a dry run, so the "Dry
    // Runs" toggle isolates exactly these 21 rows, an exact filter rather
    // than a KPI-bucket lower bound.
    await page.getByRole('button', { name: 'Dry Runs' }).click();

    // KPI cards report the real DB count of the filtered set, not a tally
    // of the ≤20 rows rendered in the table below them — all 21 fixtures
    // are seeded `status: 'completed'`.
    await expect(page.getByText('21', { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(20, { timeout: 10_000 });
    const loadMoreButton = page.getByRole('button', { name: 'Load more' });
    await expect(loadMoreButton).toBeVisible();

    await loadMoreButton.click();
    await expect(rows).toHaveCount(21);
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  });
});
