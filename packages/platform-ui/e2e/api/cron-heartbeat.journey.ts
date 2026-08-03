import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { backdatePostgresTriggerCursor } from '../helpers/postgres-seed';

/**
 * POST /api/cron/heartbeat — Phase 3 of the headless-platform-API migration.
 *
 * The handler is system-actor only and audit-emits `cron.trigger.fired` per
 * fired trigger; skipped triggers (no-schedule / invalid / not-due / a payload
 * the resolved version no longer accepts) surface in the response body +
 * console.log but MUST NOT emit audit. Verifies the "emit only on state change"
 * invariant locked in ADR-0005 §7.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const AUTH_HEADERS = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };

async function deleteWorkflowDefinition(
  request: { delete: (url: string, opts?: object) => Promise<{ ok: boolean }>, get: (url: string, opts?: object) => Promise<{ ok: boolean, json: () => Promise<unknown> }> },
  name: string,
): Promise<void> {
  const countRes = await request.get(
    `/api/workflow-definitions/${encodeURIComponent(name)}/run-count?namespace=${TEST_ORG_HANDLE}`,
    { headers: AUTH_HEADERS },
  );
  const expectedRunCount = countRes.ok
    ? ((await countRes.json()) as { count: number }).count
    : 0;
  await request.delete(
    `/api/workflow-definitions/${encodeURIComponent(name)}?namespace=${TEST_ORG_HANDLE}`,
    { headers: AUTH_HEADERS, data: { expectedRunCount } },
  );
}

/** The smallest registerable workflow: one creation step into one terminal step.
 *  Callers add a `triggerInput` contract on top when the tick under test needs
 *  one. */
function noopWd(name: string) {
  return {
    name,
    title: 'Cron heartbeat E2E',
    steps: [
      { id: 'noop', name: 'Noop', type: 'creation', executor: 'human' },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'noop', to: 'done' }],
  };
}

test.describe('POST /api/cron/heartbeat — API E2E', () => {
  test('requires X-Api-Key (middleware 401)', async ({ request }) => {
    const res = await request.post('/api/cron/heartbeat');
    expect(res.status()).toBe(401);
  });

  test('returns { triggered, skipped } shape with apiKey', async ({ request }) => {
    const res = await request.post('/api/cron/heartbeat', {
      headers: { 'X-Api-Key': API_KEY },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as {
      triggered: Array<unknown>;
      skipped: Array<unknown>;
    };
    expect(Array.isArray(body.triggered)).toBe(true);
    expect(Array.isArray(body.skipped)).toBe(true);
  });

  test('back-to-back heartbeats skip with "Not due" and do not re-fire', async ({
    request,
  }) => {
    const wdName = `e2e-cron-${Date.now()}`;
    const createWdRes = await request.post(
      `/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`,
      {
        headers: AUTH_HEADERS,
        data: noopWd(wdName),
      },
    );
    expect(createWdRes.status()).toBe(201);

    // Definitions are trigger-free (Issue #932): attach the cron trigger to the
    // registered workflow via the triggers table.
    const createTriggerRes = await request.post(
      `/api/workflow-definitions/${encodeURIComponent(wdName)}/triggers`,
      {
        headers: AUTH_HEADERS,
        data: { namespace: TEST_ORG_HANDLE, triggerName: 'every-15m', type: 'cron', schedule: '*/15 * * * *' },
      },
    );
    expect(createTriggerRes.ok(), await createTriggerRes.text()).toBe(true);

    try {
      // Prime trigger state — first heartbeat may fire or skip depending on
      // isDue() semantics vs def.createdAt. We don't assert on the first
      // result; the invariant under test is the second back-to-back call.
      await request.post('/api/cron/heartbeat', {
        headers: { 'X-Api-Key': API_KEY },
      });

      const second = await request.post('/api/cron/heartbeat', {
        headers: { 'X-Api-Key': API_KEY },
      });
      expect(second.status()).toBe(200);
      const body = (await second.json()) as {
        triggered: Array<{ definitionName: string }>;
        skipped: Array<{ definitionName: string; triggerName: string; reason: string }>;
      };
      const ourSkip = body.skipped.find(
        (s) => s.definitionName === wdName && s.triggerName === 'every-15m',
      );
      expect(ourSkip?.reason).toBe('Not due');
      const ourFire = body.triggered.find((t) => t.definitionName === wdName);
      expect(ourFire).toBeUndefined();
    } finally {
      await deleteWorkflowDefinition(request, wdName);
    }
  });

  test('a due tick whose payload drifted from the resolved version skips instead of firing', async ({
    request,
  }) => {
    const wdName = `e2e-cron-drift-${Date.now()}`;
    const triggersUrl = `/api/workflow-definitions/${encodeURIComponent(wdName)}/triggers`;
    const cursor = new Date(Date.now() - 60 * 60 * 1000);

    // v1 declares `region`, so the payload attached below is legal at write time
    // — the attach-time half of ADR-0012's two-stage check passes.
    const createV1Res = await request.post(
      `/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`,
      {
        headers: AUTH_HEADERS,
        data: {
          ...noopWd(wdName),
          triggerInput: [{ name: 'region', type: 'string', required: false }],
        },
      },
    );
    expect(createV1Res.status(), await createV1Res.text()).toBe(201);

    try {
      const createTriggerRes = await request.post(triggersUrl, {
        headers: AUTH_HEADERS,
        data: {
          namespace: TEST_ORG_HANDLE,
          triggerName: 'every-15m',
          type: 'cron',
          schedule: '*/15 * * * *',
          payload: { region: 'eu' },
        },
      });
      expect(createTriggerRes.ok(), await createTriggerRes.text()).toBe(true);

      // v2 moves the contract under the untouched trigger row: `region` is gone
      // and `studyId` is now required. Nobody edited the trigger — this is drift.
      const createV2Res = await request.post(
        `/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`,
        {
          headers: AUTH_HEADERS,
          data: {
            ...noopWd(wdName),
            triggerInput: [{ name: 'studyId', type: 'string', required: true }],
          },
        },
      );
      expect(createV2Res.status(), await createV2Res.text()).toBe(201);

      // The payload check runs only once the tick is otherwise due, so the row
      // needs a cursor old enough for a `*/15` boundary to fall inside it.
      await backdatePostgresTriggerCursor(TEST_ORG_HANDLE, wdName, 'every-15m', cursor);

      const hbRes = await request.post('/api/cron/heartbeat', {
        headers: { 'X-Api-Key': API_KEY },
      });
      expect(hbRes.status(), await hbRes.text()).toBe(200);
      const body = (await hbRes.json()) as {
        triggered: Array<{ definitionName: string }>;
        skipped: Array<{
          definitionName: string;
          definitionVersion: number;
          triggerName: string;
          reason: string;
        }>;
      };

      const ourSkip = body.skipped.find(
        (s) => s.definitionName === wdName && s.triggerName === 'every-15m',
      );
      // Not "Not due" and not a 500: drift is reported like a deleted workflow
      // or an invalid schedule — a skip carrying the version that rejected it.
      expect(ourSkip?.reason).toMatch(/^Payload no longer satisfies triggerInput of v2: /);
      expect(ourSkip?.reason).toContain("unknown field 'region'");
      expect(ourSkip?.definitionVersion).toBe(2);
      expect(body.triggered.find((t) => t.definitionName === wdName)).toBeUndefined();

      // A skipped tick is not a state change: the cursor stays where it was, so
      // the tick fires as soon as someone repairs the payload.
      const listRes = await request.get(`${triggersUrl}?namespace=${TEST_ORG_HANDLE}`, {
        headers: AUTH_HEADERS,
      });
      expect(listRes.ok(), await listRes.text()).toBe(true);
      const { triggers } = (await listRes.json()) as {
        triggers: Array<{ name: string; lastTriggeredAt: string | null }>;
      };
      const row = triggers.find((t) => t.name === 'every-15m');
      expect(new Date(row?.lastTriggeredAt ?? 0).getTime()).toBe(cursor.getTime());
    } finally {
      await request.delete(`${triggersUrl}/every-15m?namespace=${TEST_ORG_HANDLE}`, {
        headers: AUTH_HEADERS,
      });
      await deleteWorkflowDefinition(request, wdName);
    }
  });
});
