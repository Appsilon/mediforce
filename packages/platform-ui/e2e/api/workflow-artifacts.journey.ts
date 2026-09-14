import { test, expect } from '../helpers/test-fixtures';

/**
 * Files a workflow carries with it (L3). The point of storing them on the
 * definition is that they need no git checkout to reach a run, which only holds
 * if they survive the round trip through the API and the storage backend — a
 * column-per-field table silently drops what it has no column for.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const authHeaders = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };
const NAMESPACE = 'tenant-a';

const ARTIFACTS = [
  { path: 'Dockerfile', contents: 'FROM python:3.12-slim\nRUN pip install pandas\n' },
  { path: 'scripts/poll.py', contents: 'print("poll")\n' },
  { path: 'skills/data-validator/SKILL.md', contents: '# Data validator\n' },
];

function definition(name: string, artifacts?: unknown) {
  return {
    name,
    description: 'API journey for workflow artifacts',
    steps: [
      { id: 'poll', name: 'Poll', type: 'creation', executor: 'human' },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'poll', to: 'done' }],
    ...(artifacts === undefined ? {} : { artifacts }),
  };
}

test.describe('Workflow artifacts — API E2E', () => {
  test('the files a workflow carries survive registration and come back with the version', async ({ request }) => {
    const name = `api-artifacts-${Date.now()}`;

    const registered = await request.post(`/api/workflow-definitions?namespace=${NAMESPACE}`, {
      headers: authHeaders,
      data: definition(name, ARTIFACTS),
    });
    expect(registered.status(), await registered.text()).toBe(201);

    const fetched = await request.get(
      `/api/workflow-definitions/${encodeURIComponent(name)}?namespace=${NAMESPACE}`,
      { headers: authHeaders },
    );
    expect(fetched.status(), await fetched.text()).toBe(200);
    const { definition: saved } = await fetched.json() as {
      definition: { artifacts?: { path: string; contents: string }[] };
    };
    expect(saved.artifacts).toEqual(ARTIFACTS);
  });

  test('artifacts belong to the version that declared them', async ({ request }) => {
    // They ride with versions, so rolling back to an earlier version has to
    // bring back the files that version ran with.
    const name = `api-artifacts-versioned-${Date.now()}`;

    const first = await request.post(`/api/workflow-definitions?namespace=${NAMESPACE}`, {
      headers: authHeaders,
      data: definition(name, [{ path: 'scripts/poll.py', contents: 'print("v1")\n' }]),
    });
    expect(first.status(), await first.text()).toBe(201);

    const second = await request.post(`/api/workflow-definitions?namespace=${NAMESPACE}`, {
      headers: authHeaders,
      data: definition(name, [{ path: 'scripts/poll.py', contents: 'print("v2")\n' }]),
    });
    expect(second.status(), await second.text()).toBe(201);

    const v1 = await request.get(
      `/api/workflow-definitions/${encodeURIComponent(name)}?namespace=${NAMESPACE}&version=1`,
      { headers: authHeaders },
    );
    const v2 = await request.get(
      `/api/workflow-definitions/${encodeURIComponent(name)}?namespace=${NAMESPACE}&version=2`,
      { headers: authHeaders },
    );
    expect((await v1.json()).definition.artifacts[0].contents).toBe('print("v1")\n');
    expect((await v2.json()).definition.artifacts[0].contents).toBe('print("v2")\n');
  });

  test('a version that carries no files reports none, rather than an empty list', async ({ request }) => {
    const name = `api-artifacts-none-${Date.now()}`;
    const registered = await request.post(`/api/workflow-definitions?namespace=${NAMESPACE}`, {
      headers: authHeaders,
      data: definition(name),
    });
    expect(registered.status(), await registered.text()).toBe(201);

    const fetched = await request.get(
      `/api/workflow-definitions/${encodeURIComponent(name)}?namespace=${NAMESPACE}`,
      { headers: authHeaders },
    );
    expect((await fetched.json()).definition.artifacts).toBeUndefined();
  });

  test('a path that would escape the workflow directory is refused at registration', async ({ request }) => {
    const name = `api-artifacts-escape-${Date.now()}`;
    const refused = await request.post(`/api/workflow-definitions?namespace=${NAMESPACE}`, {
      headers: authHeaders,
      data: definition(name, [{ path: '../../etc/passwd', contents: 'nope' }]),
    });
    expect(refused.status(), await refused.text()).toBe(400);
    expect(await refused.text()).toMatch(/artifact path/i);
  });
});
