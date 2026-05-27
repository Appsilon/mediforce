import { test, expect } from '../helpers/test-fixtures';

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const authHeaders = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };

function workflowDefinition(name: string) {
  return {
    name,
    description: 'API journey test for namespace-scoped workflow storage',
    steps: [
      { id: 'noop', name: 'No-op Human Step', type: 'creation', executor: 'human' },
    ],
    transitions: [],
    triggers: [{ type: 'manual', name: 'start' }],
  };
}

test.describe('Workflow definition namespace isolation — API E2E', () => {
  test('same workflow name registers and resolves independently per namespace', async ({ request }) => {
    const name = `api-namespace-isolation-${Date.now()}`;
    const tenantA = 'tenant-a';
    const tenantB = 'tenant-b';

    const tenantBFirst = await request.post(
      `/api/workflow-definitions?namespace=${tenantB}`,
      { headers: authHeaders, data: workflowDefinition(name) },
    );
    expect(tenantBFirst.status(), await tenantBFirst.text()).toBe(201);
    expect((await tenantBFirst.json()).version).toBe(1);

    const tenantBSecond = await request.post(
      `/api/workflow-definitions?namespace=${tenantB}`,
      { headers: authHeaders, data: workflowDefinition(name) },
    );
    expect(tenantBSecond.status(), await tenantBSecond.text()).toBe(201);
    expect((await tenantBSecond.json()).version).toBe(2);

    const tenantAFirst = await request.post(
      `/api/workflow-definitions?namespace=${tenantA}`,
      { headers: authHeaders, data: workflowDefinition(name) },
    );
    expect(tenantAFirst.status(), await tenantAFirst.text()).toBe(201);
    expect((await tenantAFirst.json()).version).toBe(1);

    const tenantAGet = await request.get(
      `/api/workflow-definitions/${encodeURIComponent(name)}?namespace=${tenantA}`,
      { headers: authHeaders },
    );
    expect(tenantAGet.status(), await tenantAGet.text()).toBe(200);
    const tenantABody = await tenantAGet.json();
    expect(tenantABody.definition.namespace).toBe(tenantA);
    expect(tenantABody.definition.version).toBe(1);

    const tenantBGet = await request.get(
      `/api/workflow-definitions/${encodeURIComponent(name)}?namespace=${tenantB}`,
      { headers: authHeaders },
    );
    expect(tenantBGet.status(), await tenantBGet.text()).toBe(200);
    const tenantBBody = await tenantBGet.json();
    expect(tenantBBody.definition.namespace).toBe(tenantB);
    expect(tenantBBody.definition.version).toBe(2);

    const tenantAList = await request.get(
      `/api/workflow-definitions?namespace=${tenantA}`,
      { headers: authHeaders },
    );
    expect(tenantAList.status(), await tenantAList.text()).toBe(200);
    const listBody = await tenantAList.json() as {
      definitions: Array<{ namespace: string; name: string; latestVersion: number }>;
    };
    const matches = listBody.definitions.filter((definition) => definition.name === name);
    expect(matches).toEqual([
      expect.objectContaining({ namespace: tenantA, latestVersion: 1 }),
    ]);
  });
});
