import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import {
  apiKeyHeaders,
  bearerHeaders,
  setupMultiNamespaceCallers,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

/**
 * Complements `workflow-namespacing.journey.ts`. That file proves multi-namespace
 * write isolation for an api-key caller; this one exercises the user-kind 404
 * anti-enumeration path on GET /api/workflow-definitions/[name] introduced in
 * #450 (see commit `cd023487`).
 *
 * Seeded WDs in `test` are private by default — an outsider user must see
 * "not found" rather than "forbidden" to avoid leaking the workflow name.
 */

const SEEDED_PRIVATE_WD = 'Supply Chain Review';

test.describe('GET /api/workflow-definitions/[name] — visibility 404', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('api-key caller can read a private WD in any namespace', async ({ request }) => {
    const res = await request.get(
      `/api/workflow-definitions/${encodeURIComponent(SEEDED_PRIVATE_WD)}?namespace=${TEST_ORG_HANDLE}`,
      { headers: apiKeyHeaders() },
    );
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json() as { definition: { name: string; namespace: string; visibility?: string } };
    expect(body.definition.name).toBe(SEEDED_PRIVATE_WD);
    expect(body.definition.namespace).toBe(TEST_ORG_HANDLE);
  });

  test('outsider user → 404 on a private WD they have no membership for', async ({ request }) => {
    const res = await request.get(
      `/api/workflow-definitions/${encodeURIComponent(SEEDED_PRIVATE_WD)}?namespace=${TEST_ORG_HANDLE}`,
      { headers: bearerHeaders(callers.outsider) },
    );
    expect(res.status()).toBe(404);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toMatch(/not found/i);
  });

  test('nonexistent WD name → 404 (same shape as visibility denial)', async ({ request }) => {
    const res = await request.get(
      `/api/workflow-definitions/${encodeURIComponent('Does-Not-Exist-zzz')}?namespace=${TEST_ORG_HANDLE}`,
      { headers: bearerHeaders(callers.outsider) },
    );
    expect(res.status()).toBe(404);
  });
});
