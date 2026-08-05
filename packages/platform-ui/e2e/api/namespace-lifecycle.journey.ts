import { test, expect } from '../helpers/test-fixtures';
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

/**
 * Owner of the fixtures below — deliberately NOT the shared `auth-setup` user.
 * Two of these workspaces are meant to survive their test (a personal one
 * cannot be deleted, and reset keeps the workspace), so hanging them off the
 * test user would grow their workspace picker by two "My workspace" cards per
 * run and break the L4 workspace-selection journey. The api-key caller
 * bypasses membership, so these tests need no real signed-in owner.
 *
 * Handles are fixed rather than timestamped for the same reason: the seeds are
 * `ON CONFLICT DO NOTHING`, so a re-run reuses the rows instead of leaving a
 * new pair behind in the shared database.
 */
const FIXTURE_UID = 'ns-lifecycle-user';
const PERSONAL_KEEP_HANDLE = 'ns-lifecycle-keep';
const PERSONAL_RESET_HANDLE = 'ns-lifecycle-reset';
const ORG_DELETE_HANDLE = 'ns-lifecycle-org';

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
    const handle = PERSONAL_KEEP_HANDLE;
    await seedPostgresPersonalNamespace(handle, FIXTURE_UID, 'Personal Keep');

    const deleteRes = await request.delete(`/api/namespaces/${handle}`, { headers: authHeaders });
    expect(deleteRes.status(), await deleteRes.text()).toBe(409);
    expect(await deleteRes.text()).toContain('personal workspace');

    const getRes = await request.get(`/api/namespaces/${handle}`, { headers: authHeaders });
    expect(getRes.status(), await getRes.text()).toBe(200);
    expect((await getRes.json()).namespace.handle).toBe(handle);
  });

  test('reset deletes the workflows and keeps the workspace and its members', async ({ request }) => {
    const handle = PERSONAL_RESET_HANDLE;
    await seedPostgresPersonalNamespace(handle, FIXTURE_UID, 'Personal Reset');
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
    expect(body.members.map((member: { uid: string }) => member.uid)).toContain(FIXTURE_UID);
  });

  test('an organization workspace deletes for real, along with its workflows', async ({ request }) => {
    const handle = ORG_DELETE_HANDLE;
    await seedPostgresOrganizationNamespace(handle, FIXTURE_UID, 'Org Delete');
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
