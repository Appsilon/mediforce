import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { seedPostgresOrganizationNamespace } from '../helpers/postgres-seed';

/**
 * Workflow import from GitHub — API E2E.
 *
 * `POST /api/workflow-definitions/import` and `GET /api/workflow-definitions/manifest`
 * resolve a remote GitHub source and then persist / read through it. The handler
 * unit tests stub `fetch`, so nothing below the handler is proven there: this
 * journey is the only place where route input validation, the proxy's auth gate,
 * real GitHub resolution and the Postgres registration path run together against
 * both source shapes the product accepts — the plain repository URL the import
 * dialog offers by default, and a tree URL a user pastes from the GitHub UI.
 *
 * These endpoints necessarily talk to github.com — there is no local stand-in for
 * "resolve a ref to an immutable commit". The network-dependent tests probe
 * GitHub once in `beforeAll` and self-skip with a diagnostic when it is
 * unreachable or rate limited (same shape as `workspace-docker.journey`'s Docker
 * gate); the auth and validation tests never skip, so an offline run still covers
 * every assertion that does not need the network.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const authHeaders = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };

/** The default source the workflow import dialog pre-fills: the repository URL,
 *  whose manifest and paths are both repo-root-relative. */
const REPO_SOURCE = 'https://github.com/Appsilon/mediforce';
/** First entry of the root `workflows-index.json`, addressed exactly as the
 *  manifest lists it. */
const EXAMPLE_PATH = 'docs/workflow-examples/01-linear-pipeline.wd.json';
/** A GitHub *tree* URL — the shape a user gets by browsing to a directory and
 *  copying the address bar, so the ref (`main`) and the directory
 *  (`docs/workflow-examples`) share one path and have to be split apart during
 *  resolution. Its `path` is relative to that directory. */
const TREE_SOURCE = 'https://github.com/Appsilon/mediforce/tree/main/docs/workflow-examples';
const TREE_EXAMPLE_PATH = '01-linear-pipeline.wd.json';
const EXAMPLE_WORKFLOW_NAME = 'tutorial-linear-pipeline';
const FULL_COMMIT_SHA = /^[a-f0-9]{40}$/;

interface DefinitionGroup {
  name: string;
  namespace: string;
  definition: { source?: { url: string; path: string; commit: string } } | null;
}

/** True when `url` answers 2xx unauthenticated. A transport failure or a 403
 *  (GitHub rate limit) reads as "not available here", not as a product defect. */
async function isAvailable(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

const GITHUB_API_PROBE = 'https://api.github.com/repos/Appsilon/mediforce/commits/main';
const MANIFEST_PROBE =
  'https://raw.githubusercontent.com/Appsilon/mediforce/main/workflows-index.json';

test.describe('Workflow import from GitHub — API E2E', () => {
  let gitHubReachable = false;
  let manifestPublished = false;
  let namespace = '';

  test.beforeAll(async () => {
    gitHubReachable = await isAvailable(GITHUB_API_PROBE);
    manifestPublished = gitHubReachable && (await isAvailable(MANIFEST_PROBE));
  });

  // Import writes a workflow definition, and `workflow_definitions.workspace` is
  // a FK to `workspaces`, so the target handle has to exist first. One org per
  // test keeps a retry from colliding with its own earlier attempt's rows;
  // `postgres-seed` drops `import-org-%` between runs.
  test.beforeEach(async ({}, testInfo) => {
    namespace = `import-org-${testInfo.testId}`;
    await seedPostgresOrganizationNamespace(namespace, `uid-${namespace}`, 'Import Org');
  });

  test('rejects unauthenticated import and manifest requests', async ({ request }) => {
    const importRes = await request.post(
      `/api/workflow-definitions/import?namespace=${namespace}`,
      { data: { repo: REPO_SOURCE, path: EXAMPLE_PATH } },
    );
    expect(importRes.status()).toBe(401);

    const manifestRes = await request.get(
      `/api/workflow-definitions/manifest?repo=${encodeURIComponent(REPO_SOURCE)}`,
    );
    expect(manifestRes.status()).toBe(401);
  });

  test('rejects a non-GitHub repo URL with a validation error', async ({ request }) => {
    const res = await request.post(
      `/api/workflow-definitions/import?namespace=${namespace}`,
      { headers: authHeaders, data: { repo: 'https://gitlab.com/appsilon/mediforce', path: EXAMPLE_PATH } },
    );

    expect(res.status(), await res.text()).toBe(400);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('validation');
    expect(body.error.message).toContain('Only GitHub repos are supported');
  });

  test('rejects a malformed repo URL and a missing namespace before reaching the handler', async ({ request }) => {
    const malformed = await request.post(
      `/api/workflow-definitions/import?namespace=${namespace}`,
      { headers: authHeaders, data: { repo: 'github.com/Appsilon/mediforce', path: EXAMPLE_PATH } },
    );
    expect(malformed.status(), await malformed.text()).toBe(400);
    expect((await malformed.json() as { error: { code: string } }).error.code).toBe('validation');

    const noNamespace = await request.post('/api/workflow-definitions/import', {
      headers: authHeaders,
      data: { repo: REPO_SOURCE, path: EXAMPLE_PATH },
    });
    expect(noNamespace.status(), await noNamespace.text()).toBe(400);
    expect((await noNamespace.json() as { error: { code: string } }).error.code).toBe('validation');
  });

  /** Read back the single definition group `EXAMPLE_WORKFLOW_NAME` registered
   *  into the per-test namespace, so provenance is asserted against what the
   *  storage backend actually returns rather than the import response. */
  async function readImportedSource(
    request: APIRequestContext,
  ): Promise<DefinitionGroup['definition']> {
    const listRes = await request.get(`/api/workflow-definitions?namespace=${namespace}`, {
      headers: authHeaders,
    });
    expect(listRes.status(), await listRes.text()).toBe(200);
    const { definitions } = await listRes.json() as { definitions: DefinitionGroup[] };
    const imported = definitions.find((group) => group.name === EXAMPLE_WORKFLOW_NAME);

    expect(imported, `imported workflow missing from ${namespace}`).toBeDefined();
    return imported!.definition;
  }

  test('imports an example from the default repository source', async ({ request }) => {
    test.skip(!gitHubReachable, 'GitHub API unreachable or rate limited');

    const res = await request.post(
      `/api/workflow-definitions/import?namespace=${namespace}`,
      { headers: authHeaders, data: { repo: REPO_SOURCE, path: EXAMPLE_PATH } },
    );

    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json() as { success: boolean; name: string; version: number };
    expect(body.success).toBe(true);
    expect(body.name).toBe(EXAMPLE_WORKFLOW_NAME);

    expect((await readImportedSource(request))?.source).toEqual({
      url: REPO_SOURCE,
      path: EXAMPLE_PATH,
      commit: expect.stringMatching(FULL_COMMIT_SHA),
    });
  });

  // A tree URL is still a supported paste — its ref and directory are split apart
  // during resolution, and the provenance it records is normalised to the same
  // repo + repo-root-relative path a plain repository import produces, so
  // url + path + commit locates the file no matter which shape was pasted.
  test('imports a tree-scoped example and records repo-relative provenance', async ({ request }) => {
    test.skip(!gitHubReachable, 'GitHub API unreachable or rate limited');

    const res = await request.post(
      `/api/workflow-definitions/import?namespace=${namespace}`,
      { headers: authHeaders, data: { repo: TREE_SOURCE, path: TREE_EXAMPLE_PATH } },
    );

    expect(res.status(), await res.text()).toBe(201);
    expect((await readImportedSource(request))?.source).toEqual({
      url: REPO_SOURCE,
      path: EXAMPLE_PATH,
      commit: expect.stringMatching(FULL_COMMIT_SHA),
    });
  });

  // `workflows-index.json` is added by the branch that made this repository URL
  // the import default, so on `main` it does not exist yet and the shipped
  // default source has no browsable manifest. The gate is the published file
  // itself: the moment that branch merges, this test arms on its own.
  test('browses the manifest at the repository root', async ({ request }) => {
    test.skip(!gitHubReachable, 'GitHub API unreachable or rate limited');
    test.skip(!manifestPublished, `${MANIFEST_PROBE} is not published yet`);

    const res = await request.get(
      `/api/workflow-definitions/manifest?repo=${encodeURIComponent(REPO_SOURCE)}`,
      { headers: authHeaders },
    );

    expect(res.status(), await res.text()).toBe(200);
    const { workflows } = await res.json() as { workflows: Array<{ name: string; path: string }> };
    expect(workflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: EXAMPLE_WORKFLOW_NAME, path: EXAMPLE_PATH }),
      ]),
    );
  });
});
