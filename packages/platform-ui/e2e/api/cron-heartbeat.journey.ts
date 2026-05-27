import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';

/**
 * POST /api/cron/heartbeat — Phase 3 of the headless-platform-API migration.
 *
 * The handler is system-actor only and audit-emits `cron.trigger.fired` per
 * fired trigger; skipped triggers (no-schedule / invalid / not-due) surface
 * in the response body + console.log but MUST NOT emit audit. Verifies the
 * "emit only on state change" invariant locked in ADR-0005 §7.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';

test.describe('POST /api/cron/heartbeat — API E2E', () => {
  // ADR-0001 PR2: heartbeat scans WDs across workspaces; requires seeded WDs.
  // Postgres seed parity ships with postgres-seed extension pass.
  test.skip(
    process.env.STORAGE_BACKEND === 'postgres',
    'Heartbeat scans seeded WDs; Postgres seed parity ships later in PR2',
  );

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
    const cronWd = {
      name: wdName,
      title: 'Cron heartbeat E2E',
      steps: [
        { id: 'noop', name: 'Noop', type: 'creation', executor: 'human' },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'noop', to: 'done' }],
      triggers: [{ type: 'cron', name: 'every-15m', schedule: '*/15 * * * *' }],
    };
    const createWdRes = await request.post(
      `/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`,
      {
        headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
        data: cronWd,
      },
    );
    expect(createWdRes.status()).toBe(201);

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
  });
});
