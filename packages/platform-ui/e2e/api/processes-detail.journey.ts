import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  bearerHeaders,
  setupMultiNamespaceCallers,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

/**
 * L3 API E2E covering the three migrated process detail endpoints:
 *   - GET /api/processes/[instanceId]            → instance object
 *   - GET /api/processes/[instanceId]/audit      → { events } (breaking shape)
 *   - GET /api/processes/[instanceId]/steps      → derived step view
 *
 * Each verifies happy-path 200 for the api-key caller AND that an outsider
 * user (member of a different namespace) sees 404 — the anti-enumeration
 * contract the migration introduced. Audit also asserts the `{ events: [...] }`
 * envelope explicitly — that wrapper is the breaking response-shape change
 * vs `main` and the cheapest place to catch a regression is end-to-end.
 */

const INSTANCE_ID = 'proc-running-1';
const MISSING_INSTANCE_ID = 'proc-does-not-exist-zzz';

test.describe('GET /api/processes/* — API E2E', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('process instance: api-key caller gets the seeded instance', async ({ request }) => {
    const res = await request.get(`/api/processes/${INSTANCE_ID}`, {
      headers: apiKeyHeaders(),
    });
    expect(res.status(), await res.text()).toBe(200);
    const instance = (await res.json()) as {
      id: string;
      namespace: string;
      status: string;
      definitionName: string;
    };
    expect(instance.id).toBe(INSTANCE_ID);
    expect(instance.namespace).toBe('test');
    expect(instance.status).toBe('running');
  });

  test('process instance: outsider user → 404 (no namespace leak)', async ({ request }) => {
    const res = await request.get(`/api/processes/${INSTANCE_ID}`, {
      headers: bearerHeaders(callers.outsider),
    });
    expect(res.status()).toBe(404);
  });

  test('process instance: missing id → 404 with the same shape', async ({ request }) => {
    const res = await request.get(`/api/processes/${MISSING_INSTANCE_ID}`, {
      headers: apiKeyHeaders(),
    });
    expect(res.status()).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toMatch(/not found/i);
  });

  test('audit: response is wrapped as { events: [...] }', async ({ request }) => {
    const res = await request.get(`/api/processes/${INSTANCE_ID}/audit`, {
      headers: apiKeyHeaders(),
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { events?: unknown };
    expect(Array.isArray(body.events)).toBe(true);
    const events = body.events as Array<{ processInstanceId: string; action: string }>;
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.processInstanceId === INSTANCE_ID)).toBe(true);
    // The bare-array shape from `main` is now invalid — must be the wrapper.
    expect(Array.isArray(body)).toBe(false);
  });

  test('audit: outsider user → 404 (cross-namespace anti-enum)', async ({ request }) => {
    const res = await request.get(`/api/processes/${INSTANCE_ID}/audit`, {
      headers: bearerHeaders(callers.outsider),
    });
    expect(res.status()).toBe(404);
  });

  test('steps: api-key caller gets derived per-step view', async ({ request }) => {
    const res = await request.get(`/api/processes/${INSTANCE_ID}/steps`, {
      headers: apiKeyHeaders(),
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as {
      instanceId: string;
      definitionName: string;
      instanceStatus: string;
      currentStepId: string | null;
      steps: Array<{ stepId: string; status: string; executorType: string }>;
    };
    expect(body.instanceId).toBe(INSTANCE_ID);
    expect(body.instanceStatus).toBe('running');
    expect(Array.isArray(body.steps)).toBe(true);
    expect(body.steps.length).toBeGreaterThan(0);
    // Terminal steps are filtered out by the handler.
    expect(body.steps.every((step) => step.status !== undefined)).toBe(true);
  });

  test('steps: outsider user → 404 (cross-namespace anti-enum)', async ({ request }) => {
    const res = await request.get(`/api/processes/${INSTANCE_ID}/steps`, {
      headers: bearerHeaders(callers.outsider),
    });
    expect(res.status()).toBe(404);
  });
});
