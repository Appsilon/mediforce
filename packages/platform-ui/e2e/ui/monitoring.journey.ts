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

    // Workflows is the default active tab — its status cards render from the
    // summary response, proving `MonitoringSummaryCards` mounted with the
    // data `useMonitoringData` delivered.
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
});
