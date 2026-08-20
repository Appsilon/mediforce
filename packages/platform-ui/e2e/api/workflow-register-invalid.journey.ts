import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const authHeaders = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };
const namespace = 'tenant-a';

async function isStored(request: APIRequestContext, name: string): Promise<boolean> {
  const listRes = await request.get(`/api/workflow-definitions?namespace=${namespace}`, {
    headers: authHeaders,
  });
  expect(listRes.status(), await listRes.text()).toBe(200);
  const list = await listRes.json() as { definitions: Array<{ name: string }> };
  return list.definitions.some((definition) => definition.name === name);
}

test.describe('Workflow definition register rejection — API E2E', () => {
  test('rejects a structurally-invalid graph with 400 and does not persist it', async ({ request }) => {
    const name = `api-register-invalid-graph-${Date.now()}`;
    // Passes the schema, but `orphan` is unreachable from the entry step, so the
    // graph gate rejects it.
    const candidate = {
      name,
      steps: [
        { id: 'start', name: 'Start', type: 'creation', executor: 'human' },
        { id: 'orphan', name: 'Orphan', type: 'creation', executor: 'human' },
        { id: 'end', name: 'End', type: 'terminal', executor: 'human' },
      ],
      transitions: [
        { from: 'start', to: 'end' },
        { from: 'orphan', to: 'end' },
      ],
      triggers: [{ type: 'manual', name: 'manual' }],
    };

    const res = await request.post(`/api/workflow-definitions?namespace=${namespace}`, {
      headers: authHeaders,
      data: candidate,
    });
    expect(res.status(), await res.text()).toBe(400);

    expect(await isStored(request, name)).toBe(false);
  });

  test('rejects a broken step reference with 400 and does not persist it', async ({ request }) => {
    const name = `api-register-invalid-ref-${Date.now()}`;
    // Passes the schema, but references a step that does not exist.
    const candidate = {
      name,
      steps: [
        {
          id: 'start',
          name: 'Start',
          type: 'creation',
          executor: 'human',
          assignedTo: '${steps.ghost.value}',
        },
        { id: 'end', name: 'End', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'start', to: 'end' }],
      triggers: [{ type: 'manual', name: 'manual' }],
    };

    const res = await request.post(`/api/workflow-definitions?namespace=${namespace}`, {
      headers: authHeaders,
      data: candidate,
    });
    expect(res.status(), await res.text()).toBe(400);

    expect(await isStored(request, name)).toBe(false);
  });
});
