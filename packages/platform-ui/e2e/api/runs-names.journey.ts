import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  bearerHeaders,
  setupMultiNamespaceCallers,
  TEST_ORG_HANDLE,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';
import { seedCollection } from '../helpers/emulator';

/**
 * L3 API E2E for GET /api/runs/names?namespace=<handle> (issue #588).
 *
 * The endpoint returns a PROJECTED `{ runs: [{ id, definitionName }] }` slice
 * scoped to one workspace — only those two fields per run, never the full
 * ProcessInstance. Asserts the wire shape, the namespace gate (a non-member
 * caller gets an empty list — intersection semantics, NOT a 403), the
 * required-namespace 400, and that soft-deleted runs are excluded (parity with
 * the pre-cutover name-map filter).
 */

// Dedicated runs seeded into the `test` namespace so this journey doesn't
// depend on the exact contents of the shared auth-setup fixture. Ids/names are
// unique to this spec so the projected-shape assertions are deterministic.
const RUN_ONE_ID = 'proc-names-journey-1';
const RUN_TWO_ID = 'proc-names-journey-2';
const RUN_DELETED_ID = 'proc-names-journey-deleted';
const RUN_ONE_NAME = 'Names Journey Workflow A';
const RUN_TWO_NAME = 'Names Journey Workflow B';
const RUN_DELETED_NAME = 'Names Journey Soft Deleted';

function seededRun(
  id: string,
  definitionName: string,
  deleted: boolean,
): Record<string, unknown> {
  return {
    id,
    namespace: TEST_ORG_HANDLE,
    definitionName,
    definitionVersion: '1.0.0',
    configName: 'all-human',
    configVersion: '1',
    status: 'completed',
    currentStepId: null,
    variables: {},
    triggerType: 'manual',
    triggerPayload: {},
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    createdBy: 'system',
    pauseReason: null,
    error: null,
    assignedRoles: [],
    archived: false,
    deleted,
  };
}

test.describe('GET /api/runs/names — API E2E', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
    // Idempotent upserts — safe across Playwright retries / sibling journeys.
    await seedCollection('processInstances', {
      [RUN_ONE_ID]: seededRun(RUN_ONE_ID, RUN_ONE_NAME, false),
      [RUN_TWO_ID]: seededRun(RUN_TWO_ID, RUN_TWO_NAME, false),
      [RUN_DELETED_ID]: seededRun(RUN_DELETED_ID, RUN_DELETED_NAME, true),
    });
  });

  test('api-key caller: 200 projected { id, definitionName } shape, seeded runs present', async ({ request }) => {
    const res = await request.get(`/api/runs/names?namespace=${TEST_ORG_HANDLE}`, {
      headers: apiKeyHeaders(),
    });
    expect(res.status(), await res.text()).toBe(200);

    const body = await res.json() as { runs: Array<Record<string, unknown>> };
    expect(Array.isArray(body.runs)).toBe(true);

    const byId = new Map(body.runs.map((entry) => [entry.id, entry]));
    expect(byId.get(RUN_ONE_ID)).toEqual({ id: RUN_ONE_ID, definitionName: RUN_ONE_NAME });
    expect(byId.get(RUN_TWO_ID)).toEqual({ id: RUN_TWO_ID, definitionName: RUN_TWO_NAME });

    // Projection leak guard: EVERY entry has exactly the two fields — no
    // status / namespace / variables / createdAt bleeding through.
    for (const entry of body.runs) {
      expect(Object.keys(entry).sort()).toEqual(['definitionName', 'id']);
    }
  });

  test('soft-deleted runs do not appear (deleted: true excluded)', async ({ request }) => {
    const res = await request.get(`/api/runs/names?namespace=${TEST_ORG_HANDLE}`, {
      headers: apiKeyHeaders(),
    });
    expect(res.status(), await res.text()).toBe(200);

    const body = await res.json() as { runs: Array<{ id: string }> };
    const ids = body.runs.map((entry) => entry.id);
    expect(ids).not.toContain(RUN_DELETED_ID);
  });

  test('non-member caller: empty list, NOT a 403 (intersection semantics)', async ({ request }) => {
    const res = await request.get(`/api/runs/names?namespace=${TEST_ORG_HANDLE}`, {
      headers: bearerHeaders(callers.outsider),
    });
    expect(res.status(), await res.text()).toBe(200);

    const body = await res.json() as { runs: unknown[] };
    expect(body.runs).toEqual([]);
  });

  test('missing namespace query param → 400', async ({ request }) => {
    const res = await request.get('/api/runs/names', {
      headers: apiKeyHeaders(),
    });
    expect(res.status()).toBe(400);

    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('validation');
  });

  test('empty namespace query param → 400', async ({ request }) => {
    const res = await request.get('/api/runs/names?namespace=', {
      headers: apiKeyHeaders(),
    });
    expect(res.status()).toBe(400);

    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('validation');
  });
});
