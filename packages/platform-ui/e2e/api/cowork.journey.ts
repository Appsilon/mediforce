import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  bearerHeaders,
  setupMultiNamespaceCallers,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

/**
 * L3 API E2E for the two migrated cowork endpoints:
 *   - GET /api/cowork/[sessionId]                       → by id
 *   - GET /api/cowork/by-instance/[instanceId]          → most recent active
 *
 * Documented behaviour change (#450): cross-namespace and missing-instance
 * responses both surface as 404 — never 403 — so a non-member caller can't
 * tell whether the instance exists.
 */

const SESSION_ID = 'cowork-active-1';
const INSTANCE_ID = 'proc-cowork-paused';
const MISSING_INSTANCE_ID = 'proc-does-not-exist-yyy';

test.describe('GET /api/cowork/* — API E2E', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('by id: api-key caller gets the seeded session with turns and artifact', async ({ request }) => {
    const res = await request.get(`/api/cowork/${SESSION_ID}`, {
      headers: apiKeyHeaders(),
    });
    expect(res.status(), await res.text()).toBe(200);
    const session = (await res.json()) as {
      id: string;
      processInstanceId: string;
      status: string;
      turns: Array<{ role: string }>;
      artifact: unknown;
    };
    expect(session.id).toBe(SESSION_ID);
    expect(session.processInstanceId).toBe(INSTANCE_ID);
    expect(session.status).toBe('active');
    expect(session.turns.length).toBeGreaterThan(0);
    expect(session.artifact).not.toBeNull();
  });

  test('by id: outsider user → 404 (cross-namespace anti-enum)', async ({ request }) => {
    const res = await request.get(`/api/cowork/${SESSION_ID}`, {
      headers: bearerHeaders(callers.outsider),
    });
    expect(res.status()).toBe(404);
  });

  test('by-instance: api-key caller gets the most recent active session', async ({ request }) => {
    const res = await request.get(`/api/cowork/by-instance/${INSTANCE_ID}`, {
      headers: apiKeyHeaders(),
    });
    expect(res.status(), await res.text()).toBe(200);
    const session = (await res.json()) as { id: string; processInstanceId: string };
    expect(session.id).toBe(SESSION_ID);
    expect(session.processInstanceId).toBe(INSTANCE_ID);
  });

  test('by-instance: outsider user → 404 (was 403 pre-migration)', async ({ request }) => {
    const res = await request.get(`/api/cowork/by-instance/${INSTANCE_ID}`, {
      headers: bearerHeaders(callers.outsider),
    });
    expect(res.status()).toBe(404);
  });

  test('by-instance: missing instance id → 404, never 403', async ({ request }) => {
    const res = await request.get(`/api/cowork/by-instance/${MISSING_INSTANCE_ID}`, {
      headers: apiKeyHeaders(),
    });
    expect(res.status()).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toMatch(/no active cowork session/i);
  });
});
