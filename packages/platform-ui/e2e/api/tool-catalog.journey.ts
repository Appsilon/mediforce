import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';

/**
 * L3 API journey for the tool-catalog admin endpoints. Designed to run
 * under both backends:
 *
 *   - STORAGE_BACKEND unset / firestore (default `e2e-tests` job) → exercises
 *     the Firestore path.
 *   - STORAGE_BACKEND=postgres (the `e2e-tests-postgres` CI job) → exercises
 *     the Postgres path: route handler → AuthorizedToolCatalogRepository →
 *     PostgresToolCatalogRepository → Drizzle → live Postgres container.
 *
 * Two runs of the same suite is the parity guarantee at the HTTP-and-up
 * layer that the L2 contract test can't give.
 */
test.describe('tool-catalog admin API journey', () => {
  const apiKey = process.env.PLATFORM_API_KEY ?? 'test-api-key';
  const authHeaders = { 'X-Api-Key': apiKey };

  test('CRUD round-trip survives a fresh GET (works on both backends)', async ({ request }) => {
    const entryId = `e2e-tool-${Date.now()}`;
    const payload = {
      id: entryId,
      command: 'echo',
      args: ['--hello'],
      env: { TOKEN: '{{SECRET:token}}' },
      description: 'L3 round-trip',
    };

    const createRes = await request.post(
      `/api/admin/tool-catalog?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders, data: payload },
    );
    expect(createRes.status(), await createRes.text()).toBe(201);
    const created = (await createRes.json()) as { entry: typeof payload };
    expect(created.entry).toEqual(payload);

    const listRes = await request.get(
      `/api/admin/tool-catalog?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders },
    );
    expect(listRes.ok(), await listRes.text()).toBe(true);
    const list = (await listRes.json()) as { entries: Array<{ id: string }> };
    expect(list.entries.map((e) => e.id)).toContain(entryId);

    const dupRes = await request.post(
      `/api/admin/tool-catalog?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders, data: payload },
    );
    expect(dupRes.status()).toBe(409);

    const deleteRes = await request.delete(
      `/api/admin/tool-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders },
    );
    expect(deleteRes.ok(), await deleteRes.text()).toBe(true);

    const afterDelete = await request.get(
      `/api/admin/tool-catalog?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders },
    );
    const remaining = (await afterDelete.json()) as { entries: Array<{ id: string }> };
    expect(remaining.entries.map((e) => e.id)).not.toContain(entryId);
  });
});
