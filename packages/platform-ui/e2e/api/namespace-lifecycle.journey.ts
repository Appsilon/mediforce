import { test, expect } from '../helpers/test-fixtures';
import { TEST_USER_ID } from '../helpers/constants';
import {
  seedPostgresOrganizationNamespace,
  seedPostgresPersonalNamespace,
} from '../helpers/postgres-seed';

/**
 * API-level journey for the workspace danger zone (issue #1044).
 *
 * "Delete workspace" on a personal workspace used to cascade the contents away
 * and let `GET /api/users/me` hand back a fresh empty one — a reset wearing a
 * delete label. Deleting a personal workspace is now refused outright, and
 * `POST /api/namespaces/:handle/reset` is the named action for wiping its
 * workflows while the workspace survives.
 */
const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const authHeaders = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };

function workflowDefinition(name: string) {
  return {
    name,
    description: 'API journey test for the workspace danger zone',
    steps: [
      { id: 'noop', name: 'No-op Human Step', type: 'creation', executor: 'human' },
    ],
    transitions: [],
  };
}

test.describe('Workspace delete vs reset — API E2E', () => {
  test('a personal workspace refuses deletion and survives', async ({ request }) => {
    const handle = `personal-keep-${Date.now()}`;
    await seedPostgresPersonalNamespace(handle, TEST_USER_ID, 'Personal Keep');

    const deleteRes = await request.delete(`/api/namespaces/${handle}`, { headers: authHeaders });
    expect(deleteRes.status(), await deleteRes.text()).toBe(409);
    expect(await deleteRes.text()).toContain('personal workspace');

    const getRes = await request.get(`/api/namespaces/${handle}`, { headers: authHeaders });
    expect(getRes.status(), await getRes.text()).toBe(200);
    expect((await getRes.json()).namespace.handle).toBe(handle);
  });

  test('reset deletes the workflows and keeps the workspace and its members', async ({ request }) => {
    const handle = `personal-reset-${Date.now()}`;
    await seedPostgresPersonalNamespace(handle, TEST_USER_ID, 'Personal Reset');
    const name = `reset-flow-${Date.now()}`;

    const register = await request.post(
      `/api/workflow-definitions?namespace=${handle}`,
      { headers: authHeaders, data: workflowDefinition(name) },
    );
    expect(register.status(), await register.text()).toBe(201);

    const resetRes = await request.post(`/api/namespaces/${handle}/reset`, { headers: authHeaders });
    expect(resetRes.status(), await resetRes.text()).toBe(200);
    expect(await resetRes.json()).toMatchObject({ handle, deletedWorkflows: 1, deletedRuns: 0 });

    const list = await request.get(
      `/api/workflow-definitions?namespace=${handle}`,
      { headers: authHeaders },
    );
    const listBody = (await list.json()) as { definitions: Array<{ name: string }> };
    expect(listBody.definitions.filter((definition) => definition.name === name)).toHaveLength(0);

    // The workspace itself — and the membership that grants access to it —
    // outlive the reset. That is the whole difference from a delete.
    const getRes = await request.get(`/api/namespaces/${handle}`, { headers: authHeaders });
    expect(getRes.status(), await getRes.text()).toBe(200);
    const body = await getRes.json();
    expect(body.namespace.handle).toBe(handle);
    expect(body.members.map((member: { uid: string }) => member.uid)).toContain(TEST_USER_ID);
  });

  test('an organization workspace deletes for real, along with its workflows', async ({ request }) => {
    const handle = `org-delete-${Date.now()}`;
    await seedPostgresOrganizationNamespace(handle, TEST_USER_ID, 'Org Delete');
    const name = `deleted-flow-${Date.now()}`;

    const register = await request.post(
      `/api/workflow-definitions?namespace=${handle}`,
      { headers: authHeaders, data: workflowDefinition(name) },
    );
    expect(register.status(), await register.text()).toBe(201);

    const deleteRes = await request.delete(`/api/namespaces/${handle}`, { headers: authHeaders });
    expect(deleteRes.status(), await deleteRes.text()).toBe(200);
    expect(await deleteRes.json()).toEqual({ handle });

    const getRes = await request.get(`/api/namespaces/${handle}`, { headers: authHeaders });
    expect(getRes.status(), await getRes.text()).toBe(404);

    const list = await request.get('/api/workflow-definitions', { headers: authHeaders });
    const listBody = (await list.json()) as { definitions: Array<{ name: string }> };
    expect(listBody.definitions.filter((definition) => definition.name === name)).toHaveLength(0);
  });
});
