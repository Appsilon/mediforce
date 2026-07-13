import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';

/**
 * Cron Trigger management API (ADR-0010). Proves the full HTTP + storage + auth
 * path for adding a cron trigger to an EXISTING workflow, starting/stopping it,
 * modifying its schedule, and deleting it — none of which requires registering
 * a new workflow version. Also verifies a stopped trigger does not fire on the
 * heartbeat, and delete cascades.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const AUTH_HEADERS = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };

const base = `/api/workflow-definitions`;

async function deleteWorkflowDefinition(
  request: {
    delete: (url: string, opts?: object) => Promise<{ ok: boolean }>;
    get: (url: string, opts?: object) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  },
  name: string,
): Promise<void> {
  const countRes = await request.get(
    `${base}/${encodeURIComponent(name)}/run-count?namespace=${TEST_ORG_HANDLE}`,
    { headers: AUTH_HEADERS },
  );
  const expectedRunCount = countRes.ok
    ? ((await countRes.json()) as { count: number }).count
    : 0;
  await request.delete(`${base}/${encodeURIComponent(name)}?namespace=${TEST_ORG_HANDLE}`, {
    headers: AUTH_HEADERS,
    data: { expectedRunCount },
  });
}

// A workflow declaring only a manual trigger — proves we can ADD a cron trigger
// to a workflow that never declared one, without a new version.
function manualOnlyWd(name: string) {
  return {
    name,
    title: 'Cron management E2E',
    steps: [
      { id: 'noop', name: 'Noop', type: 'creation', executor: 'human' },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'noop', to: 'done' }],
    triggers: [{ type: 'manual', name: 'manual' }],
  };
}

test.describe('Cron Trigger management — API E2E', () => {
  test('add → list → update → stop → heartbeat-skip → delete lifecycle', async ({ request }) => {
    const wdName = `e2e-cronmgmt-${Date.now()}`;
    const cronUrl = `${base}/${encodeURIComponent(wdName)}/cron-triggers`;
    const triggerUrl = `${cronUrl}/nightly`;

    const createWdRes = await request.post(`${base}?namespace=${TEST_ORG_HANDLE}`, {
      headers: AUTH_HEADERS,
      data: manualOnlyWd(wdName),
    });
    expect(createWdRes.status(), await createWdRes.text()).toBe(201);

    try {
      // Add a cron trigger to the existing (manual-only) workflow.
      const createRes = await request.post(cronUrl, {
        headers: AUTH_HEADERS,
        data: { namespace: TEST_ORG_HANDLE, triggerName: 'nightly', schedule: '0 3 * * *' },
      });
      expect(createRes.ok(), await createRes.text()).toBe(true);
      const created = (await createRes.json()) as { trigger: { schedule: string; enabled: boolean } };
      expect(created.trigger.schedule).toBe('0 3 * * *');
      expect(created.trigger.enabled).toBe(true);

      // Duplicate add → 409.
      const dupRes = await request.post(cronUrl, {
        headers: AUTH_HEADERS,
        data: { namespace: TEST_ORG_HANDLE, triggerName: 'nightly', schedule: '0 4 * * *' },
      });
      expect(dupRes.status()).toBe(409);

      // Invalid schedule (minute not 15-aligned) → 400-class validation error.
      const badRes = await request.post(cronUrl, {
        headers: AUTH_HEADERS,
        data: { namespace: TEST_ORG_HANDLE, triggerName: 'bad', schedule: '5 3 * * *' },
      });
      expect(badRes.ok()).toBe(false);

      // List reflects the created trigger.
      const listRes = await request.get(`${cronUrl}?namespace=${TEST_ORG_HANDLE}`, {
        headers: AUTH_HEADERS,
      });
      expect(listRes.ok()).toBe(true);
      const list = (await listRes.json()) as { triggers: Array<{ triggerName: string }> };
      expect(list.triggers.map((t) => t.triggerName)).toContain('nightly');

      // Modify the live schedule — no new workflow version.
      const updateRes = await request.patch(triggerUrl, {
        headers: AUTH_HEADERS,
        data: { namespace: TEST_ORG_HANDLE, schedule: '0 5 * * *' },
      });
      expect(updateRes.ok(), await updateRes.text()).toBe(true);
      const updated = (await updateRes.json()) as { trigger: { schedule: string } };
      expect(updated.trigger.schedule).toBe('0 5 * * *');

      // Stop the trigger (enabled=false) — still listed, not deleted.
      const stopRes = await request.post(`${triggerUrl}/enabled`, {
        headers: AUTH_HEADERS,
        data: { namespace: TEST_ORG_HANDLE, enabled: false },
      });
      expect(stopRes.ok(), await stopRes.text()).toBe(true);
      const stopped = (await stopRes.json()) as { trigger: { enabled: boolean } };
      expect(stopped.trigger.enabled).toBe(false);

      // A stopped trigger must never fire on the heartbeat.
      const hbRes = await request.post('/api/cron/heartbeat', {
        headers: { 'X-Api-Key': API_KEY },
      });
      expect(hbRes.status()).toBe(200);
      const hb = (await hbRes.json()) as { triggered: Array<{ definitionName: string }> };
      expect(hb.triggered.find((t) => t.definitionName === wdName)).toBeUndefined();

      // Delete removes it.
      const delRes = await request.delete(`${triggerUrl}?namespace=${TEST_ORG_HANDLE}`, {
        headers: AUTH_HEADERS,
      });
      expect(delRes.ok()).toBe(true);
      const afterList = await request.get(`${cronUrl}?namespace=${TEST_ORG_HANDLE}`, {
        headers: AUTH_HEADERS,
      });
      const after = (await afterList.json()) as { triggers: Array<unknown> };
      expect(after.triggers).toHaveLength(0);
    } finally {
      await deleteWorkflowDefinition(request, wdName);
    }
  });
});
