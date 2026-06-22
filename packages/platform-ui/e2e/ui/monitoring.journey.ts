import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Monitoring Journey', () => {
  test('monitoring page mounts and calls the headless summary endpoint', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await setupRecording(page, 'monitoring-dashboard', testInfo);

    // ADR-0006 §4 NICE LIVE: the summary endpoint replaces the old Firestore
    // `processInstances` subscription for the four status cards. Lock in
    // that the page actually calls it (rather than silently falling back to
    // legacy paths). Race the request against the navigation so the listener
    // is armed before the request fires.
    const summaryRequest = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/namespaces/${TEST_ORG_HANDLE}/monitoring/summary`) && res.request().method() === 'GET',
      { timeout: 30_000 },
    );

    await page.goto(`/${TEST_ORG_HANDLE}/monitoring`);
    await expect(page.getByText('Real-time view of all workflows and task assignments')).toBeVisible({
      timeout: 30_000,
    });
    await showStep(page);

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

    // Workflow Status section + 4 cards (Running / Paused / Failed / Completed)
    // must render from the summary response. Asserting label visibility
    // proves `MonitoringSummaryCards` mounted with the data the hook
    // delivered — the rendering risk this L4 closes.
    await expect(page.getByRole('heading', { name: 'Workflow Status' })).toBeVisible();
    await expect(page.getByText('Running', { exact: true })).toBeVisible();
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();
    await expect(page.getByText('Failed', { exact: true })).toBeVisible();
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    await showStep(page);

    // Two side-by-side sections render below the cards. `AssignmentMap` reads
    // `summary.roleTaskCounts`; `StuckProcessesList` still pulls from the
    // Firestore subscription (`useProcessInstances`) until that domain's
    // react-query migration lands — both must coexist on the page.
    await expect(page.getByRole('heading', { name: 'Stuck Workflows' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Task Assignments by Role' })).toBeVisible();
    await showResult(page);

    await endRecording(page);
  });
});
