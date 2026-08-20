import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { ApiError, Mediforce } from '@mediforce/platform-api/client';
import type { CronTriggerResource, TriggerResource } from '@mediforce/platform-core';

/**
 * Trigger management API (ADR-0011; cron, manual, and webhook on the unified
 * `triggers` table). Proves the full HTTP + storage + auth path for attaching
 * triggers to an EXISTING workflow, starting/stopping, modifying, and deleting
 * them — none of which requires registering a new workflow version. Also
 * verifies a stopped cron trigger does not fire on the heartbeat, the manual
 * singleton gates hand-start, a webhook's derived URL starts a run while it is
 * attached and 404s once removed, and a cron row's static payload (ADR-0012)
 * survives the write → storage → read round trip.
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
  };
}

/** Same shape plus a `triggerInput` contract. Under ADR-0012 every firing
 *  validates against it, so a webhook body needs declared fields to carry —
 *  `order` required and `note` optional, which exercises both the happy path and
 *  the rejections. Kept separate from `manualOnlyWd` because a *required* field
 *  also blocks attaching a payload-less cron row, which the cron tests rely on. */
function webhookContractWd(name: string) {
  return { ...manualOnlyWd(name), triggerInput: [
    { name: 'order', type: 'number', required: true },
    { name: 'note', type: 'string', required: false },
  ] };
}

/** A contract an EMPTY payload still satisfies: the required field carries a
 *  `default`, which under ADR-0012 belongs to the contract and is filled in for
 *  any firing that omits it. That is what makes "clear the payload" a legal
 *  write here, unlike on `webhookContractWd` (required, no default). */
function defaultedContractWd(name: string) {
  return { ...manualOnlyWd(name), triggerInput: [
    { name: 'studyId', type: 'string', required: true, default: 'STUDY-DEFAULT' },
    { name: 'priority', type: 'select', options: ['low', 'normal'], required: false },
  ] };
}

/**
 * The trigger API as a real caller reaches it. The cron static payload shipped
 * broken because the client hand-builds each request body and dropped `payload`
 * on create and update — a journey that hand-rolls the same body would have
 * stayed green while the UI and `mediforce workflow trigger --payload` were
 * both dead, so the payload cases drive the client instead of `request`.
 */
function apiClient(baseURL: string | undefined): Mediforce {
  if (baseURL === undefined) {
    throw new Error('Playwright baseURL is not configured — cannot build an API client');
  }
  return new Mediforce({ apiKey: API_KEY, baseUrl: baseURL });
}

function cronConfigOf(trigger: TriggerResource): CronTriggerResource['config'] {
  if (trigger.type !== 'cron') {
    throw new Error(`Expected a cron trigger, got '${trigger.type}'`);
  }
  return trigger.config;
}

/** The payload as it comes back OUT of storage on a fresh read — the half of the
 *  round trip a create/update response echo can't prove. */
async function storedCronPayload(
  mediforce: Mediforce,
  definitionName: string,
  triggerName: string,
): Promise<Record<string, unknown> | undefined> {
  const { triggers } = await mediforce.triggers.list({
    namespace: TEST_ORG_HANDLE,
    definitionName,
  });
  const row = triggers.find((t) => t.name === triggerName);
  if (row === undefined) {
    throw new Error(`Trigger '${triggerName}' not found on '${definitionName}'`);
  }
  return cronConfigOf(row).payload;
}

/** Assert a write was REFUSED and hand back the error. A resolved promise fails
 *  the test — the bug being guarded against reported success while discarding
 *  the edit, so "did not throw" can never be a pass. */
async function expectApiError(pending: Promise<unknown>): Promise<ApiError> {
  try {
    await pending;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('Expected the write to be rejected, but it succeeded');
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
      data: webhookContractWd(wdName),
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

      // ADR-0012: the body's top-level keys ARE the triggerInput contract, and
      // it is enforced end-to-end — through the real route, not just the router.
      const undeclaredRes = await request.post(created.webhookUrl, {
        headers: AUTH_HEADERS,
        data: { order: 42, undeclared: 'nope' },
      });
      expect(undeclaredRes.status()).toBe(400);
      const undeclaredBody = (await undeclaredRes.json()) as {
        error: string;
        details?: Array<{ field: string }>;
      };
      // Per-field errors travel on `details`, mirroring what start-run returns
      // for a rejected manual payload.
      expect(undeclaredBody.details?.map((d) => d.field)).toContain('undeclared');

      const missingRes = await request.post(created.webhookUrl, {
        headers: AUTH_HEADERS,
        data: { note: 'no order here' },
      });
      expect(missingRes.status()).toBe(400);

      const mistypedRes = await request.post(created.webhookUrl, {
        headers: AUTH_HEADERS,
        data: { order: 'forty-two' },
      });
      expect(mistypedRes.status()).toBe(400);

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

  test('portable trigger file: export → import round-trips into another workflow (Issue #933)', async ({
    request,
  }) => {
    const sourceName = `e2e-trig-export-${Date.now()}`;
    const targetName = `e2e-trig-import-${Date.now()}`;
    const sourceTriggersUrl = `${base}/${encodeURIComponent(sourceName)}/triggers`;
    const targetTriggersUrl = `${base}/${encodeURIComponent(targetName)}/triggers`;

    // Both workflows start manual-only (seed-on-register, Issue #930).
    for (const name of [sourceName, targetName]) {
      const res = await request.post(`${base}?namespace=${TEST_ORG_HANDLE}`, {
        headers: AUTH_HEADERS,
        data: manualOnlyWd(name),
      });
      expect(res.status(), await res.text()).toBe(201);
    }

    try {
      // Attach a cron + webhook to the source, on top of its seeded manual.
      const cronRes = await request.post(sourceTriggersUrl, {
        headers: AUTH_HEADERS,
        data: { namespace: TEST_ORG_HANDLE, triggerName: 'nightly', type: 'cron', schedule: '0 3 * * *' },
      });
      expect(cronRes.ok(), await cronRes.text()).toBe(true);
      const webhookRes = await request.post(sourceTriggersUrl, {
        headers: AUTH_HEADERS,
        data: {
          namespace: TEST_ORG_HANDLE,
          triggerName: 'webhook',
          type: 'webhook',
          method: 'POST',
          path: '/intake',
        },
      });
      expect(webhookRes.ok(), await webhookRes.text()).toBe(true);

      // Export → portable, instance-free array (proves GET route + auth path).
      const exportRes = await request.get(
        `${sourceTriggersUrl}/export?namespace=${TEST_ORG_HANDLE}`,
        { headers: AUTH_HEADERS },
      );
      expect(exportRes.ok(), await exportRes.text()).toBe(true);
      const { triggers } = (await exportRes.json()) as {
        triggers: Array<Record<string, unknown>>;
      };
      expect(triggers.map((t) => t.name).sort()).toEqual(['manual', 'nightly', 'webhook']);
      for (const t of triggers) {
        expect(t).not.toHaveProperty('namespace');
        expect(t).not.toHaveProperty('lastTriggeredAt');
      }

      // Import into the target (proves POST route + storage + auth path).
      const importRes = await request.post(`${targetTriggersUrl}/import`, {
        headers: AUTH_HEADERS,
        data: { namespace: TEST_ORG_HANDLE, triggers, replace: false },
      });
      expect(importRes.ok(), await importRes.text()).toBe(true);
      const { results } = (await importRes.json()) as {
        results: Array<{ name: string; outcome: string; webhookUrl: string | null }>;
      };
      const byName = Object.fromEntries(results.map((r) => [r.name, r]));
      // The seeded manual collides with the target's own manual → skipped;
      // cron + webhook are created.
      expect(byName.nightly.outcome).toBe('created');
      expect(byName.webhook.outcome).toBe('created');
      expect(byName.manual.outcome).toBe('skipped');
      // Webhook URL re-derived for the TARGET workflow/host.
      expect(byName.webhook.webhookUrl).toBe(
        `/api/triggers/webhook/${TEST_ORG_HANDLE}/${targetName}/intake`,
      );

      // The target now lists the imported triggers alongside its seeded manual.
      const listRes = await request.get(`${targetTriggersUrl}?namespace=${TEST_ORG_HANDLE}`, {
        headers: AUTH_HEADERS,
      });
      const list = (await listRes.json()) as { triggers: Array<{ name: string }> };
      expect(list.triggers.map((t) => t.name).sort()).toEqual(['manual', 'nightly', 'webhook']);

      // Re-import with replace flips the cron schedule on the existing row —
      // and leaves no duplicate rows behind.
      const changed = triggers.map((t) =>
        t.type === 'cron' ? { ...t, schedule: '0 5 * * *' } : t,
      );
      const replaceRes = await request.post(`${targetTriggersUrl}/import`, {
        headers: AUTH_HEADERS,
        data: { namespace: TEST_ORG_HANDLE, triggers: changed, replace: true },
      });
      expect(replaceRes.ok(), await replaceRes.text()).toBe(true);
      const afterList = await request.get(`${targetTriggersUrl}?namespace=${TEST_ORG_HANDLE}`, {
        headers: AUTH_HEADERS,
      });
      const after = (await afterList.json()) as {
        triggers: Array<{ name: string; type: string; config: { schedule?: string } }>;
      };
      expect(after.triggers.find((t) => t.type === 'cron')?.config.schedule).toBe('0 5 * * *');
      expect(after.triggers.map((t) => t.name).sort()).toEqual(['manual', 'nightly', 'webhook']);
    } finally {
      await deleteWorkflowDefinition(request, sourceName);
      await deleteWorkflowDefinition(request, targetName);
    }
  });

  test('cron static payload: create persists it, update replaces it, {} clears it (ADR-0012)', async ({
    request,
    baseURL,
  }) => {
    const wdName = `e2e-cronpayload-${Date.now()}`;
    const mediforce = apiClient(baseURL);
    const nightly = {
      namespace: TEST_ORG_HANDLE,
      definitionName: wdName,
      triggerName: 'nightly',
    };

    const createWdRes = await request.post(`${base}?namespace=${TEST_ORG_HANDLE}`, {
      headers: AUTH_HEADERS,
      data: defaultedContractWd(wdName),
    });
    expect(createWdRes.status(), await createWdRes.text()).toBe(201);

    try {
      // Create WITH a payload — a cron tick has no caller, so this row is where
      // the input it hands the Run is authored.
      const created = await mediforce.triggers.create({
        ...nightly,
        type: 'cron',
        enabled: true,
        schedule: '0 3 * * *',
        payload: { studyId: 'STUDY-A', priority: 'low' },
      });
      expect(cronConfigOf(created.trigger).payload).toEqual({
        studyId: 'STUDY-A',
        priority: 'low',
      });
      // Read back from storage, not from the create echo.
      expect(await storedCronPayload(mediforce, wdName, 'nightly')).toEqual({
        studyId: 'STUDY-A',
        priority: 'low',
      });

      // Update REPLACES the payload wholesale (it is not merged) and carries the
      // schedule over untouched.
      const updated = await mediforce.triggers.update({
        ...nightly,
        payload: { studyId: 'STUDY-B' },
      });
      expect(cronConfigOf(updated.trigger).schedule).toBe('0 3 * * *');
      expect(await storedCronPayload(mediforce, wdName, 'nightly')).toEqual({
        studyId: 'STUDY-B',
      });

      // `payload: {}` CLEARS — the row becomes indistinguishable from one that
      // never carried a payload, which is legal here because `studyId` has a
      // default the contract fills in.
      await mediforce.triggers.update({ ...nightly, payload: {} });
      expect(await storedCronPayload(mediforce, wdName, 'nightly')).toBeUndefined();

      // Identically on create: `{}` stores no payload rather than an empty one.
      const weekly = await mediforce.triggers.create({
        ...nightly,
        triggerName: 'weekly',
        type: 'cron',
        enabled: true,
        schedule: '0 4 * * *',
        payload: {},
      });
      expect(cronConfigOf(weekly.trigger).payload).toBeUndefined();
      expect(await storedCronPayload(mediforce, wdName, 'weekly')).toBeUndefined();
    } finally {
      await deleteWorkflowDefinition(request, wdName);
    }
  });

  test('cron payload is validated against triggerInput at write time (ADR-0012 fail-fast)', async ({
    request,
    baseURL,
  }) => {
    const wdName = `e2e-cronpayload-reject-${Date.now()}`;
    const mediforce = apiClient(baseURL);
    const nightly = {
      namespace: TEST_ORG_HANDLE,
      definitionName: wdName,
      triggerName: 'nightly',
    };
    const cronRow = { ...nightly, type: 'cron' as const, enabled: true, schedule: '0 3 * * *' };

    // `order` is required with NO default, so nothing fills it in for a
    // payload-less row.
    const createWdRes = await request.post(`${base}?namespace=${TEST_ORG_HANDLE}`, {
      headers: AUTH_HEADERS,
      data: webhookContractWd(wdName),
    });
    expect(createWdRes.status(), await createWdRes.text()).toBe(201);

    try {
      // A payload that violates the contract is refused on write, naming every
      // offending field rather than the first one.
      const violating = await expectApiError(
        mediforce.triggers.create({
          ...cronRow,
          payload: { order: 'forty-two', typo: 'nope' },
        }),
      );
      expect(violating.status).toBe(400);
      expect(violating.message).toContain("'order' must be a number");
      expect(violating.message).toContain("unknown field 'typo'");

      // A payload-less cron on a contract with a required, defaultless field can
      // never fire, so attaching it is refused too — with the reason spelled out.
      const payloadLess = await expectApiError(mediforce.triggers.create(cronRow));
      expect(payloadLess.status).toBe(400);
      expect(payloadLess.message).toContain('must carry a payload');

      // Neither refusal left a row behind (the seeded manual is all there is).
      const listed = await mediforce.triggers.list({
        namespace: TEST_ORG_HANDLE,
        definitionName: wdName,
      });
      expect(listed.triggers.map((t) => t.name)).toEqual(['manual']);

      // The same check guards the PATCH route: a rejected edit leaves the stored
      // payload exactly as it was.
      await mediforce.triggers.create({ ...cronRow, payload: { order: 42 } });
      const badUpdate = await expectApiError(
        mediforce.triggers.update({ ...nightly, payload: { order: 43, typo: 'nope' } }),
      );
      expect(badUpdate.status).toBe(400);
      expect(await storedCronPayload(mediforce, wdName, 'nightly')).toEqual({ order: 42 });
    } finally {
      await deleteWorkflowDefinition(request, wdName);
    }
  });
});
