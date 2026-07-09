import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  bearerHeaders,
  setupMultiNamespaceCallers,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

/**
 * L3 API E2E for GET /api/plugins.
 *
 * Plugin registry is platform-wide (no namespace gate) — every authenticated
 * caller sees the same list, regardless of their namespace membership.
 * Asserted from both an api-key caller and a user-kind caller in a foreign
 * namespace to prove the route does not accidentally gate plugin discovery.
 */

test.describe('GET /api/plugins — API E2E', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('api-key caller receives a plugin list', async ({ request }) => {
    const res = await request.get('/api/plugins', { headers: apiKeyHeaders() });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json() as { plugins: Array<{ name: string }> };
    expect(Array.isArray(body.plugins)).toBe(true);
    expect(body.plugins.every((plugin) => typeof plugin.name === 'string')).toBe(true);
  });

  test('outsider user sees the same list shape — no namespace gate', async ({ request }) => {
    const apiKeyRes = await request.get('/api/plugins', { headers: apiKeyHeaders() });
    const userRes = await request.get('/api/plugins', {
      headers: bearerHeaders(callers.outsider),
    });
    expect(userRes.status(), await userRes.text()).toBe(200);

    const apiKeyBody = await apiKeyRes.json() as { plugins: Array<{ name: string }> };
    const userBody = await userRes.json() as { plugins: Array<{ name: string }> };
    const apiKeyNames = apiKeyBody.plugins.map((plugin) => plugin.name).sort();
    const userNames = userBody.plugins.map((plugin) => plugin.name).sort();
    expect(userNames).toEqual(apiKeyNames);
  });

  test('unauthenticated caller is rejected at the middleware', async ({ request }) => {
    const res = await request.get('/api/plugins');
    expect(res.status()).toBe(401);
  });
});
