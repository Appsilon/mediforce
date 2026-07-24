import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';

/**
 * Trigger management API (ADR-0011; cron, manual, and webhook on the unified
 * `triggers` table). Proves the full HTTP + storage + auth path for attaching
 * triggers to an EXISTING workflow, starting/stopping, modifying, and deleting
 * them — none of which requires registering a new workflow version. Also
 * verifies a stopped cron trigger does not fire on the heartbeat, the manual
 * singleton gates hand-start, and a webhook's derived URL starts a run while it
 * is attached and 404s once removed.
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
    title: 'Trigger management E2E',
    steps: [
      { id: 'noop', name: 'Noop', type: 'creation', executor: 'human' },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'noop', to: 'done' }],
    triggers: [{ type: 'manual', name: 'manual' }],
  };
}

test.describe('Trigger management — API E2E', () => {
  test('add → list → update → stop → heartbeat-skip → delete lifecycle', async ({ request }) => {
    const wdName = `e2e-triggermgmt-${Date.now()}`;
    const triggersUrl = `${base}/${encodeURIComponent(wdName)}/triggers`;
    const triggerUrl = `${triggersUrl}/nightly`;

    const createWdRes = await request.post(`${base}?namespace=${TEST_ORG_HANDLE}`, {
      headers: AUTH_HEADERS,
      data: manualOnlyWd(wdName),
    });
    expect(createWdRes.status(), await createWdRes.text()).toBe(201);

    try {
      // Add a cron trigger to the existing (manual-only) workflow.
      const createRes = await request.post(triggersUrl, {
        headers: AUTH_HEADERS,
        data: { namespace: TEST_ORG_HANDLE, triggerName: 'nightly', type: 'cron', schedule: '0 3 * * *' },
      });
      expect(createRes.ok(), await createRes.text()).toBe(true);
      const created = (await createRes.json()) as {
        trigger: { config: { schedule: string }; enabled: boolean };
      };
      expect(created.trigger.config.schedule).toBe('0 3 * * *');
      expect(created.trigger.enabled).toBe(true);

      // Duplicate add → 409.
      const dupRes = await request.post(triggersUrl, {
        headers: AUTH_HEADERS,
        data: { namespace: TEST_ORG_HANDLE, triggerName: 'nightly', type: 'cron', schedule: '0 4 * * *' },
      });
      expect(dupRes.status()).toBe(409);

      // Invalid schedule (minute not 15-aligned) → validation error.
      const badRes = await request.post(triggersUrl, {
        headers: AUTH_HEADERS,
        data: { namespace: TEST_ORG_HANDLE, triggerName: 'bad', type: 'cron', schedule: '5 3 * * *' },
      });
      expect(badRes.ok()).toBe(false);

      // List reflects the created trigger.
      const listRes = await request.get(`${triggersUrl}?namespace=${TEST_ORG_HANDLE}`, {
        headers: AUTH_HEADERS,
      });
      expect(listRes.ok()).toBe(true);
      const list = (await listRes.json()) as { triggers: Array<{ name: string }> };
      expect(list.triggers.map((t) => t.name)).toContain('nightly');

      // Modify the live schedule — no new workflow version.
      const updateRes = await request.patch(triggerUrl, {
        headers: AUTH_HEADERS,
        data: { namespace: TEST_ORG_HANDLE, schedule: '0 5 * * *' },
      });
      expect(updateRes.ok(), await updateRes.text()).toBe(true);
      const updated = (await updateRes.json()) as { trigger: { config: { schedule: string } } };
      expect(updated.trigger.config.schedule).toBe('0 5 * * *');

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
      const afterList = await request.get(`${triggersUrl}?namespace=${TEST_ORG_HANDLE}`, {
        headers: AUTH_HEADERS,
      });
      const after = (await afterList.json()) as { triggers: Array<{ name: string }> };
      // The cron 'nightly' is gone; the seed-on-register 'manual' row remains
      // (Issue #930 — new workflows are hand-startable by default).
      expect(after.triggers.map((t) => t.name)).toEqual(['manual']);
    } finally {
      await deleteWorkflowDefinition(request, wdName);
    }
  });

  test('webhook trigger: attach → POST derived URL starts a run → remove → 404 (Issue #931)', async ({
    request,
  }) => {
    const wdName = `e2e-webhook-${Date.now()}`;
    const triggersUrl = `${base}/${encodeURIComponent(wdName)}/triggers`;
    const webhookTriggerUrl = `${triggersUrl}/webhook`;

    const createWdRes = await request.post(`${base}?namespace=${TEST_ORG_HANDLE}`, {
      headers: AUTH_HEADERS,
      data: manualOnlyWd(wdName),
    });
    expect(createWdRes.status(), await createWdRes.text()).toBe(201);

    try {
      // Attach a webhook to the existing (manual-only) workflow — no new version.
      const createRes = await request.post(triggersUrl, {
        headers: AUTH_HEADERS,
        data: {
          namespace: TEST_ORG_HANDLE,
          triggerName: 'webhook',
          type: 'webhook',
          method: 'POST',
          path: '/orders',
        },
      });
      expect(createRes.ok(), await createRes.text()).toBe(true);
      const created = (await createRes.json()) as { webhookUrl: string };
      expect(created.webhookUrl).toBe(`/api/triggers/webhook/${TEST_ORG_HANDLE}/${wdName}/orders`);

      // A second webhook is rejected — one webhook per workflow.
      const dupRes = await request.post(triggersUrl, {
        headers: AUTH_HEADERS,
        data: {
          namespace: TEST_ORG_HANDLE,
          triggerName: 'webhook-2',
          type: 'webhook',
          method: 'POST',
          path: '/other',
        },
      });
      expect(dupRes.status()).toBe(409);

      // POST the derived URL → a run starts (202 + runId).
      const fireRes = await request.post(created.webhookUrl, {
        headers: AUTH_HEADERS,
        data: { order: 42 },
      });
      expect(fireRes.status(), await fireRes.text()).toBe(202);
      const fired = (await fireRes.json()) as { runId: string };
      expect(fired.runId.length).toBeGreaterThan(0);

      // Remove the webhook → the endpoint stops resolving (404).
      const delRes = await request.delete(`${webhookTriggerUrl}?namespace=${TEST_ORG_HANDLE}`, {
        headers: AUTH_HEADERS,
      });
      expect(delRes.ok(), await delRes.text()).toBe(true);
      const goneRes = await request.post(created.webhookUrl, {
        headers: AUTH_HEADERS,
        data: { order: 43 },
      });
      expect(goneRes.status()).toBe(404);
    } finally {
      await deleteWorkflowDefinition(request, wdName);
    }
  });

  test('manual trigger gates hand-start (enabled → 201, disabled/deleted → 409)', async ({
    request,
  }) => {
    const wdName = `e2e-manualgate-${Date.now()}`;
    const manualEnabledUrl = `${base}/${encodeURIComponent(wdName)}/triggers/manual/enabled`;
    const manualUrl = `${base}/${encodeURIComponent(wdName)}/triggers/manual`;

    const createWdRes = await request.post(`${base}?namespace=${TEST_ORG_HANDLE}`, {
      headers: AUTH_HEADERS,
      data: manualOnlyWd(wdName),
    });
    expect(createWdRes.status(), await createWdRes.text()).toBe(201);

    const startData = {
      namespace: TEST_ORG_HANDLE,
      definitionName: wdName,
      triggeredBy: 'e2e-test',
      triggerName: 'manual',
    };

    try {
      // Registration seeded an enabled manual trigger → hand-start succeeds.
      const okStart = await request.post('/api/processes', {
        headers: AUTH_HEADERS,
        data: startData,
      });
      expect(okStart.status(), await okStart.text()).toBe(201);

      // Stop the manual trigger → hand-start is now rejected (409, not 500).
      const stopRes = await request.post(manualEnabledUrl, {
        headers: AUTH_HEADERS,
        data: { namespace: TEST_ORG_HANDLE, enabled: false },
      });
      expect(stopRes.ok(), await stopRes.text()).toBe(true);
      const blockedStart = await request.post('/api/processes', {
        headers: AUTH_HEADERS,
        data: startData,
      });
      expect(blockedStart.status()).toBe(409);

      // Re-enable → start works again.
      const startRes = await request.post(manualEnabledUrl, {
        headers: AUTH_HEADERS,
        data: { namespace: TEST_ORG_HANDLE, enabled: true },
      });
      expect(startRes.ok()).toBe(true);
      const reStart = await request.post('/api/processes', {
        headers: AUTH_HEADERS,
        data: startData,
      });
      expect(reStart.status()).toBe(201);

      // The manual trigger is a singleton switch — it can be stopped but never
      // removed, so a delete is rejected.
      const delRes = await request.delete(`${manualUrl}?namespace=${TEST_ORG_HANDLE}`, {
        headers: AUTH_HEADERS,
      });
      expect(delRes.ok()).toBe(false);
    } finally {
      await deleteWorkflowDefinition(request, wdName);
    }
  });
});
