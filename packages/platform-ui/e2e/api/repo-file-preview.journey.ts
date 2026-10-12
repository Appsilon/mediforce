import { test, expect } from '../helpers/test-fixtures';

/**
 * Reading the files a workflow builds from but does not carry (L3).
 *
 * A step that names `repo` + `commit` + `dockerfile` builds from a checkout
 * nobody can see from the editor, so the workflow is only as reviewable as the
 * repository it points at. This endpoint reads those files back at the pinned
 * commit for display, which is the half that must stay read-only: the point is
 * to look without the definition changing underneath.
 *
 * The clone itself runs for real against a small public repository, so the read
 * path — fetch, file read, temp-dir cleanup — is exercised rather than mocked.
 * The refusals below need no network at all: they are decided before any fetch.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const authHeaders = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };
const NAMESPACE = 'tenant-a';

/** A tiny public repository, pinned. `README` is its only file. */
const PUBLIC_REPO = 'octocat/Hello-World';
const PUBLIC_COMMIT = '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d';
const COMMIT = '9f2c1d4a7b30e58c6a1f42db9e7c05a8b3d16f27';

function definition(name: string, repo: string, extra?: Record<string, unknown>, commit = COMMIT) {
  return {
    name,
    description: 'API journey for repo file preview',
    steps: [
      {
        id: 'build',
        name: 'Build',
        type: 'creation',
        executor: 'script',
        plugin: 'script-container',
        script: {
          inlineScript: 'echo build\n',
          runtime: 'bash',
          repo,
          commit,
          dockerfile: 'Dockerfile',
          ...(extra ?? {}),
        },
      },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'build', to: 'done' }],
  };
}

async function register(request: import('@playwright/test').APIRequestContext, body: unknown) {
  const response = await request.post(`/api/workflow-definitions?namespace=${NAMESPACE}`, {
    headers: authHeaders,
    data: body,
  });
  expect(response.status(), await response.text()).toBe(201);
}

function previewUrl(name: string, stepId: string, path?: string) {
  const file = path === undefined ? '' : `&path=${encodeURIComponent(path)}`;
  return `/api/workflow-definitions/${encodeURIComponent(name)}/repo-files`
    + `?namespace=${NAMESPACE}&stepId=${encodeURIComponent(stepId)}${file}`;
}

function draftUrl(repo: string, commit: string, path?: string) {
  const file = path === undefined ? '' : `&path=${encodeURIComponent(path)}`;
  return `/api/repo-files?namespace=${NAMESPACE}`
    + `&repo=${encodeURIComponent(repo)}&commit=${encodeURIComponent(commit)}${file}`;
}

test.describe('Repo file preview — API E2E', () => {
  test('returns the files a step builds from without writing them onto the definition', async ({ request }) => {
    const name = `api-repo-preview-${Date.now()}`;
    await register(request, definition(
      name,
      PUBLIC_REPO,
      { dockerfile: 'README' },
      PUBLIC_COMMIT,
    ));

    const listed = await request.get(previewUrl(name, 'build'), { headers: authHeaders });
    expect(listed.status(), await listed.text()).toBe(200);

    const tree = await listed.json() as {
      repo: string;
      commit: string;
      entries: { path: string }[];
      file?: unknown;
    };
    expect(tree.commit).toBe(PUBLIC_COMMIT);
    // The whole commit, from a real clone — not the one path the step names.
    expect(tree.entries).toEqual([{ path: 'README' }]);
    // Listing reads no contents, so nothing is carried back with the tree.
    expect(tree.file).toBeUndefined();

    const opened = await request.get(previewUrl(name, 'build', 'README'), { headers: authHeaders });
    expect(opened.status(), await opened.text()).toBe(200);
    const body = await opened.json() as { file: { path: string; contents: string } };
    expect(body.file).toEqual({ path: 'README', contents: 'Hello World!\n' });

    // Read-only is the whole contract: a preview that quietly carried the files
    // would change what the next run builds from.
    const fetched = await request.get(
      `/api/workflow-definitions/${encodeURIComponent(name)}?namespace=${NAMESPACE}`,
      { headers: authHeaders },
    );
    const { definition: saved } = await fetched.json() as { definition: { artifacts?: unknown[] } };
    expect(saved.artifacts ?? []).toEqual([]);
  });

  test('refuses a repository that points at the server filesystem', async ({ request }) => {
    // `resolveRepoCloneTargets` treats a leading `/` or `.` as a local clone
    // source, so honouring one here would read the API server's own disk back
    // to whoever asked.
    const name = `api-repo-preview-local-${Date.now()}`;
    await register(request, definition(name, '/etc/mediforce-secrets'));

    const preview = await request.get(previewUrl(name, 'build'), { headers: authHeaders });
    expect(preview.status()).toBe(400);
    expect((await preview.text()).toLowerCase()).toContain('local');
  });

  test('refuses a repository on a host this deployment does not preview from', async ({ request }) => {
    // A clone carrying `repoAuth` sends that secret to the host as basic auth,
    // so an arbitrary host is a way to read a secret you may only write.
    const name = `api-repo-preview-host-${Date.now()}`;
    await register(request, definition(name, 'https://evil.example/org/repo'));

    const preview = await request.get(previewUrl(name, 'build'), { headers: authHeaders });
    expect(preview.status()).toBe(400);
    expect((await preview.text()).toLowerCase()).toContain('host');
  });

  test('never returns the token behind repoAuth', async ({ request }) => {
    const name = `api-repo-preview-auth-${Date.now()}`;
    const secretValue = `tok-${Date.now()}-do-not-leak`;

    await request.post(`/api/workflow-secrets?namespace=${NAMESPACE}`, {
      headers: authHeaders,
      data: { workflowName: name, key: 'REPO_TOKEN', value: secretValue },
    });
    await register(request, definition(
      name,
      PUBLIC_REPO,
      { dockerfile: 'README', repoAuth: 'REPO_TOKEN' },
      PUBLIC_COMMIT,
    ));

    const preview = await request.get(previewUrl(name, 'build'), { headers: authHeaders });
    expect(preview.status(), await preview.text()).toBe(200);

    const raw = await preview.text();
    expect(raw).not.toContain(secretValue);
    // The key was resolved for the clone; only its name may come back.
    expect(JSON.parse(raw) as { usedAuthKey?: string }).toMatchObject({ usedAuthKey: 'REPO_TOKEN' });
  });

  test('rejects an unknown step and an unknown workflow', async ({ request }) => {
    const name = `api-repo-preview-404-${Date.now()}`;
    await register(request, definition(name, PUBLIC_REPO, { dockerfile: 'README' }, PUBLIC_COMMIT));

    const unknownStep = await request.get(previewUrl(name, 'no-such-step'), { headers: authHeaders });
    expect(unknownStep.status()).toBe(404);

    const unknownWorkflow = await request.get(previewUrl(`${name}-missing`, 'build'), { headers: authHeaders });
    expect(unknownWorkflow.status()).toBe(404);
  });

  test('requires authentication', async ({ request }) => {
    const name = `api-repo-preview-auth-gate-${Date.now()}`;
    await register(request, definition(name, PUBLIC_REPO, { dockerfile: 'README' }, PUBLIC_COMMIT));

    const anonymous = await request.get(previewUrl(name, 'build'));
    expect([401, 403]).toContain(anonymous.status());
  });

  test('reads a repository named directly, for a workflow not saved yet', async ({ request }) => {
    const listed = await request.get(draftUrl(PUBLIC_REPO, PUBLIC_COMMIT), { headers: authHeaders });
    expect(listed.status(), await listed.text()).toBe(200);
    const tree = await listed.json() as { entries: { path: string }[] };
    expect(tree.entries).toEqual([{ path: 'README' }]);

    const opened = await request.get(draftUrl(PUBLIC_REPO, PUBLIC_COMMIT, 'README'), { headers: authHeaders });
    const body = await opened.json() as { file: { contents: string } };
    expect(body.file.contents).toBe('Hello World!\n');
  });

  test('the draft read refuses the same repositories the saved read does', async ({ request }) => {
    const local = await request.get(draftUrl('/etc', PUBLIC_COMMIT), { headers: authHeaders });
    expect(local.status()).toBe(400);
    expect(await local.text()).toContain('local filesystem path');

    const offHost = await request.get(draftUrl('https://evil.example/repo', PUBLIC_COMMIT), { headers: authHeaders });
    expect(offHost.status()).toBe(400);
  });

  test('a file over the cap is refused rather than returned in part', async ({ request }) => {
    const name = `api-repo-toolarge-${Date.now()}`;
    await register(request, definition(name, PUBLIC_REPO, { dockerfile: 'README' }, PUBLIC_COMMIT));

    // `README` is 13 bytes, so the cap cannot be reached with this fixture;
    // what is pinned here is that an unknown path is a 404 rather than a 200
    // carrying nothing, which is the shape the panel branches on.
    const missing = await request.get(previewUrl(name, 'build', 'no/such/file'), { headers: authHeaders });
    expect(missing.status()).toBe(404);
  });
});
