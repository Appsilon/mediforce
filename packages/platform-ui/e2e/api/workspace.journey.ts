import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';

/**
 * API-level journey for the WD.workspace schema.
 *
 * Browserless — uses Playwright's `request` fixture to hit the platform API directly.
 * This is the first API-only journey in the repo; the pattern is useful whenever
 * we want to verify platform behaviour that does not need a UI.
 */
test.describe('WD.workspace API journey', () => {
  // Locally bootstrap_e2e.py writes `test-api-key`; CI overrides via env.
  const apiKey = process.env.PLATFORM_API_KEY ?? 'test-api-key';
  const authHeaders = { 'X-Api-Key': apiKey };

  test('workspace config persists verbatim through POST → GET round-trip', async ({ request }) => {
    const uniqueName = `api-workspace-roundtrip-${Date.now()}`;
    const wd = {
      name: uniqueName,
      description: 'API journey test — workspace round-trip',
      steps: [
        { id: 'noop', name: 'No-op Human Step', type: 'creation', executor: 'human' },
      ],
      transitions: [],
      triggers: [{ type: 'manual', name: 'start' }],
      workspace: {
        remote: 'Appsilon/workspace-roundtrip-fixture',
        remoteAuth: 'GITHUB_TOKEN',
      },
    };

    const createRes = await request.post(
      `/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders, data: wd },
    );
    expect(createRes.status(), await createRes.text()).toBe(201);
    const created = await createRes.json();
    expect(created.name).toBe(uniqueName);
    expect(created.version).toBeGreaterThan(0);

    const listRes = await request.get('/api/workflow-definitions', { headers: authHeaders });
    expect(listRes.ok(), await listRes.text()).toBe(true);
    const list = (await listRes.json()) as {
      definitions: Array<{ name: string; definition: { workspace?: unknown } | null }>;
    };
    const found = list.definitions.find((d) => d.name === uniqueName);
    expect(found, `WD ${uniqueName} should be in the list`).toBeDefined();
    expect(found!.definition).not.toBeNull();
    expect(found!.definition!.workspace).toEqual({
      remote: 'Appsilon/workspace-roundtrip-fixture',
      remoteAuth: 'GITHUB_TOKEN',
    });
  });

  test('omitting workspace leaves no phantom default on the stored definition', async ({ request }) => {
    const uniqueName = `api-workspace-absent-${Date.now()}`;
    const wd = {
      name: uniqueName,
      description: 'API journey test — no workspace configured',
      steps: [
        { id: 'noop', name: 'No-op', type: 'creation', executor: 'human' },
      ],
      transitions: [],
      triggers: [{ type: 'manual', name: 'start' }],
    };

    const createRes = await request.post(
      `/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders, data: wd },
    );
    expect(createRes.status()).toBe(201);

    const listRes = await request.get('/api/workflow-definitions', { headers: authHeaders });
    const list = (await listRes.json()) as {
      definitions: Array<{ name: string; definition: { workspace?: unknown } | null }>;
    };
    const found = list.definitions.find((d) => d.name === uniqueName);
    expect(found!.definition!.workspace).toBeUndefined();
  });
});
