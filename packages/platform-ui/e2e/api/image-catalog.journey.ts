import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  sessionCookieHeaders,
  setupMultiNamespaceCallers,
  TEST_ORG_HANDLE,
  type MultiNamespaceFixture,
  type UserCaller,
} from '../helpers/multi-namespace';
import { createTestUser, signInAndGetSessionCookie } from '../helpers/emulator';
import { seedPostgresWorkspaceMember } from '../helpers/postgres-seed';

/**
 * L3 API journey for the Image Catalog (ADR-0022, issue #1294). Runs against
 * Postgres: route adapter → AuthorizedImageCatalogRepository →
 * PostgresImageCatalogRepository → Drizzle → live Postgres container.
 *
 * Each test catalogues its own source, so nothing here depends on what the
 * daemon happens to hold or on what a parallel journey catalogued: the entry
 * id is derived from the source, so a unique repo yields a unique row.
 */

interface VersionView {
  imageId: string;
  imageTag: string;
  capabilities:
    | { status: 'unknown' }
    | { status: 'known'; agentCapable: boolean; runtimes: string[] };
  lineage: {
    base: { entryId: string; imageId: string; imageTag: string } | null;
    ownLabels: Record<string, string>;
    addedSteps?: { command: string; size: string }[];
  };
}

interface EntryView {
  id: string;
  name: string;
  intent: string;
  source: { kind: string; repo?: string; dockerfile?: string; reference?: string };
  origin: 'catalogued' | 'discovered';
  versions: VersionView[];
  availability: 'present' | 'absent' | 'unknown';
  baseEntryId: string | null;
}

/** The image the capability probe runs against: `alpine` has a shell and none
 *  of the probed runtimes, so its honest answer is a known, empty set — the
 *  case the agent picker must drop rather than offer. */
const PROBE_BASE_IMAGE = 'alpine:3.22';

function docker(...args: string[]): void {
  execFileSync('docker', args, { stdio: 'pipe' });
}

/**
 * Derive `tag` from `from` by running one command and committing the result.
 *
 * `docker commit` rather than `docker build`: it adds exactly one real
 * filesystem layer — which is what lineage matches on — in about a second and
 * without occupying BuildKit. Every test in this suite reads the same daemon
 * on every request, so a journey that keeps it busy times its neighbours out.
 */
function deriveImage(tag: string, from: string, command: string): void {
  const container = `mediforce-e2e-lineage-${tag.replace(/[^a-z0-9]/gi, '-')}`;
  docker('run', '--name', container, from, ...command.split(' '));
  try {
    docker('commit', container, tag);
  } finally {
    docker('rm', '-f', container);
  }
}

/**
 * Tag an image with the provenance labels the platform's builders write.
 *
 * `docker commit --change LABEL` rather than a real build: what the catalog
 * reads is the labels, and a `docker build` would cost a BuildKit run to
 * produce the same five strings.
 */
function labelAsBuilt(
  tag: string,
  from: string,
  labels: { repo: string; dockerfile: string; namespace: string; workflow: string },
): void {
  const container = `mediforce-e2e-built-${tag.replace(/[^a-z0-9]/gi, '-')}`;
  docker('run', '--name', container, from, 'true');
  try {
    docker(
      'commit',
      '--change',
      `LABEL mediforce.build.repo=${labels.repo}`,
      '--change',
      `LABEL mediforce.build.dockerfile=${labels.dockerfile}`,
      '--change',
      `LABEL mediforce.build.namespace=${labels.namespace}`,
      '--change',
      `LABEL mediforce.build.workflow=${labels.workflow}`,
      '--change',
      'LABEL mediforce.build.commit=bf0353b123bee142100ae5605ec15ad7605ceb4f',
      container,
      tag,
    );
  } finally {
    docker('rm', '-f', container);
  }
}

/**
 * A throwaway git repo with a one-line Dockerfile, returned with its commit.
 *
 * A real repo rather than a stub: the build path clones and checks out, so a
 * fixture that skipped git would test everything except the part that runs in
 * production. A bare absolute path keeps it off the network and is the local
 * form `resolveRepoCloneTargets` accepts — `file://` is not, and is rewritten
 * into a GitHub SSH reference. `_discovered.ts` drops local paths, but nothing
 * about *versions* does, and this exercise is a catalogued entry gaining one.
 */
function createBuildFixtureRepo(): { repoUrl: string; commit: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mediforce-e2e-buildsrc-'));
  writeFileSync(join(dir, 'Dockerfile'), `FROM ${PROBE_BASE_IMAGE}\nRUN touch /built-on-demand\n`);
  const git = (...args: string[]): void => {
    execFileSync('git', ['-C', dir, ...args], {
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'e2e',
        GIT_AUTHOR_EMAIL: 'e2e@example.com',
        GIT_COMMITTER_NAME: 'e2e',
        GIT_COMMITTER_EMAIL: 'e2e@example.com',
      },
    });
  };
  git('init', '--initial-branch=main');
  git('add', 'Dockerfile');
  git('commit', '-m', 'fixture');
  const commit = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { stdio: 'pipe' })
    .toString()
    .trim();
  return { repoUrl: dir, commit, dir };
}

function dockerAvailable(): boolean {
  try {
    docker('info');
    return true;
  } catch {
    return false;
  }
}

function catalogUrl(namespace: string = TEST_ORG_HANDLE): string {
  return `/api/image-catalog?namespace=${namespace}`;
}

function entryPayload(suffix: string) {
  return {
    name: `E2E image ${suffix}`,
    intent: 'R-based interactive exploration of ADaM datasets',
    source: {
      kind: 'built' as const,
      repo: `Appsilon/e2e-${suffix}`,
      dockerfile: 'container/Dockerfile',
    },
  };
}

// One worker, in order: every test here reads the same Docker daemon through
// `docker images` / `system df` / `image inspect`, and this one also commits
// two images. Run concurrently they starve each other, and the failure lands on
// whichever neighbour was mid-request. Not `serial` — a failure must not skip
// the rest of the file.
test.describe.configure({ mode: 'default' });

test.describe('image catalog API journey', () => {
  let callers: MultiNamespaceFixture;
  /**
   * A caller with `member` role in the test workspace.
   *
   * `callers.member` will not do for a role gate: the shared fixture seeds that
   * user as the workspace **owner**, so it passes every admin assert. Seeded
   * here rather than added to the shared fixture, whose outsider is load-bearing
   * for other journeys' 404 anti-enumeration probes.
   */
  let plainMember: UserCaller;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
    const uid = await createTestUser(
      'image-catalog-member@mediforce.dev',
      'imagecatalog123456',
      'Image Catalog Member',
    );
    await seedPostgresWorkspaceMember(TEST_ORG_HANDLE, uid, 'member', 'Image Catalog Member');
    plainMember = {
      uid,
      sessionCookie: await signInAndGetSessionCookie(
        'image-catalog-member@mediforce.dev',
        'imagecatalog123456',
      ),
    };
  });

  test.beforeEach(() => {
    // Every request here reads the Docker daemon server-side — `docker images`,
    // `docker system df` and `docker image inspect`, seconds of shelling out
    // per call — and the CRUD journey below makes six of them in a row. The
    // default 30s is a timing assertion nobody meant to write.
    test.setTimeout(90_000);
  });

  test('CRUD round-trip: create, list scoped, read, update, delete', async ({ request }) => {
    const payload = entryPayload(`crud-${Date.now()}`);

    const createRes = await request.post(catalogUrl(), {
      headers: apiKeyHeaders(),
      data: payload,
    });
    expect(createRes.status(), await createRes.text()).toBe(201);
    const created = (await createRes.json()) as { entry: EntryView };
    expect(created.entry.intent).toBe(payload.intent);
    // The repo is canonicalised to the URL the build labels carry, so the
    // entry reconciles against the daemon with no second source of truth.
    expect(created.entry.source.repo).toBe(`git@github.com:${payload.source.repo}.git`);

    const listRes = await request.get(catalogUrl(), { headers: apiKeyHeaders() });
    expect(listRes.ok(), await listRes.text()).toBe(true);
    const list = (await listRes.json()) as { entries: EntryView[] };
    expect(list.entries.map((e) => e.id)).toContain(created.entry.id);

    const getRes = await request.get(
      `/api/image-catalog/${created.entry.id}?namespace=${TEST_ORG_HANDLE}`,
      { headers: apiKeyHeaders() },
    );
    expect(getRes.ok(), await getRes.text()).toBe(true);
    expect(((await getRes.json()) as { entry: EntryView }).entry.name).toBe(payload.name);

    const patchRes = await request.patch(
      `/api/image-catalog/${created.entry.id}?namespace=${TEST_ORG_HANDLE}`,
      { headers: apiKeyHeaders(), data: { intent: 'Now with renv pinning' } },
    );
    expect(patchRes.ok(), await patchRes.text()).toBe(true);
    const patched = (await patchRes.json()) as { entry: EntryView };
    expect(patched.entry.intent).toBe('Now with renv pinning');
    expect(patched.entry.id).toBe(created.entry.id);

    const deleteRes = await request.delete(
      `/api/image-catalog/${created.entry.id}?namespace=${TEST_ORG_HANDLE}`,
      { headers: apiKeyHeaders() },
    );
    expect(deleteRes.ok(), await deleteRes.text()).toBe(true);

    const afterDelete = await request.get(catalogUrl(), { headers: apiKeyHeaders() });
    const remaining = (await afterDelete.json()) as { entries: EntryView[] };
    expect(remaining.entries.map((e) => e.id)).not.toContain(created.entry.id);
  });

  test('an entry whose image is not on the daemon still lists, marked unavailable', async ({
    request,
  }) => {
    // Nothing has ever been built from this repo, so the entry has no version
    // on the daemon. It must still list — never 404, never hidden.
    const payload = entryPayload(`absent-${Date.now()}`);
    const createRes = await request.post(catalogUrl(), {
      headers: apiKeyHeaders(),
      data: payload,
    });
    expect(createRes.status(), await createRes.text()).toBe(201);
    const { entry } = (await createRes.json()) as { entry: EntryView };

    const getRes = await request.get(
      `/api/image-catalog/${entry.id}?namespace=${TEST_ORG_HANDLE}`,
      { headers: apiKeyHeaders() },
    );
    expect(getRes.status()).toBe(200);
    const view = ((await getRes.json()) as { entry: EntryView }).entry;
    expect(view.versions).toEqual([]);
    expect(['absent', 'unknown']).toContain(view.availability);

    await request.delete(`/api/image-catalog/${entry.id}?namespace=${TEST_ORG_HANDLE}`, {
      headers: apiKeyHeaders(),
    });
  });

  test('a version carries the capabilities probed when it was catalogued', async ({ request }) => {
    test.skip(!dockerAvailable(), 'Docker daemon not available');
    // Its own repository name, so the entry resolves to exactly this one
    // version no matter what else the runner's daemon holds.
    const reference = `mediforce-e2e-probe-${Date.now()}`;
    try {
      docker('image', 'inspect', PROBE_BASE_IMAGE);
    } catch {
      docker('pull', PROBE_BASE_IMAGE);
    }
    docker('tag', PROBE_BASE_IMAGE, `${reference}:v1`);

    const createRes = await request.post(catalogUrl(), {
      headers: apiKeyHeaders(),
      data: {
        name: 'E2E probe image',
        intent: 'Proves a catalogued version reports what the probe found',
        source: { kind: 'referenced', reference },
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(201);
    const { entry } = (await createRes.json()) as { entry: EntryView };
    expect(entry.versions.map((version) => version.imageTag)).toEqual([`${reference}:v1`]);
    expect(entry.versions[0].capabilities).toEqual({
      status: 'known',
      agentCapable: false,
      runtimes: [],
    });

    // Read back through a fresh request: the probe result is a stored column
    // (migration 0048), not something the create response computed in flight.
    const getRes = await request.get(
      `/api/image-catalog/${entry.id}?namespace=${TEST_ORG_HANDLE}`,
      { headers: apiKeyHeaders() },
    );
    expect(getRes.ok(), await getRes.text()).toBe(true);
    const view = ((await getRes.json()) as { entry: EntryView }).entry;
    expect(view.versions[0].capabilities).toEqual(entry.versions[0].capabilities);

    await request.delete(`/api/image-catalog/${entry.id}?namespace=${TEST_ORG_HANDLE}`, {
      headers: apiKeyHeaders(),
    });
    docker('rmi', `${reference}:v1`);
  });

  test('a derived image is grouped under the entry it was built on', async ({ request }) => {
    test.skip(!dockerAvailable(), 'Docker daemon not available');
    const stamp = Date.now();
    const baseReference = `mediforce-e2e-base-${stamp}`;
    const derivedReference = `mediforce-e2e-derived-${stamp}`;
    try {
      docker('image', 'inspect', PROBE_BASE_IMAGE);
    } catch {
      docker('pull', PROBE_BASE_IMAGE);
    }
    // Both images are this test's own: a tag would share `alpine`'s image id
    // with the probe journey's image, and one id cannot belong to two entries.
    deriveImage(`${baseReference}:v1`, PROBE_BASE_IMAGE, 'mkdir /base-marker');
    deriveImage(`${derivedReference}:v1`, `${baseReference}:v1`, 'mkdir /derived-marker');

    // Catalogued derivative-first, so an order that comes out right cannot be
    // insertion order.
    const created: string[] = [];
    for (const [name, reference] of [
      ['E2E derived image', derivedReference],
      ['E2E base image', baseReference],
    ]) {
      const res = await request.post(catalogUrl(), {
        headers: apiKeyHeaders(),
        data: {
          name,
          intent: 'Proves lineage is computed from layers, not from a FROM string',
          source: { kind: 'referenced', reference },
        },
      });
      expect(res.status(), await res.text()).toBe(201);
      created.push(((await res.json()) as { entry: EntryView }).entry.id);
    }
    const [derivedId, baseId] = created;

    const listRes = await request.get(catalogUrl(), { headers: apiKeyHeaders() });
    const { entries } = (await listRes.json()) as { entries: EntryView[] };
    const derived = entries.find((entry) => entry.id === derivedId);
    const base = entries.find((entry) => entry.id === baseId);
    expect(derived?.baseEntryId).toBe(baseId);
    // Not asserted a root: `alpine` beneath it may be catalogued by a sibling
    // journey, and resolving to that would be the *nearest* base rule working.
    expect(base?.baseEntryId).not.toBe(derivedId);
    // Grouped: the base is listed before what was built on it.
    expect(entries.findIndex((entry) => entry.id === baseId)).toBeLessThan(
      entries.findIndex((entry) => entry.id === derivedId),
    );

    const getRes = await request.get(`/api/image-catalog/${derivedId}?namespace=${TEST_ORG_HANDLE}`, {
      headers: apiKeyHeaders(),
    });
    expect(getRes.ok(), await getRes.text()).toBe(true);
    const [version] = ((await getRes.json()) as { entry: EntryView }).entry.versions;
    expect(version.lineage.base?.imageTag).toBe(`${baseReference}:v1`);
    // The delta is cut at the base boundary: what this image adds, and only
    // that — the base's own step, and alpine's below it, stay out.
    const commands = (version.lineage.addedSteps ?? []).map((step) => step.command);
    expect(commands).toEqual(['mkdir /derived-marker']);

    for (const id of created) {
      await request.delete(`/api/image-catalog/${id}?namespace=${TEST_ORG_HANDLE}`, {
        headers: apiKeyHeaders(),
      });
    }
    docker('rmi', `${derivedReference}:v1`, `${baseReference}:v1`);
  });

  test('an image this namespace built is offered undescribed, and describing it keeps its id', async ({
    request,
  }) => {
    test.skip(!dockerAvailable(), 'Docker daemon not available');
    // Nobody catalogues this source: the point is that the listing offers it
    // anyway, because the build labelled which namespace it was built for.
    const stamp = Date.now();
    const repo = `git@github.com:Appsilon/e2e-discovered-${stamp}.git`;
    const tag = `mediforce-e2e-discovered-${stamp}:latest`;
    try {
      docker('image', 'inspect', PROBE_BASE_IMAGE);
    } catch {
      docker('pull', PROBE_BASE_IMAGE);
    }
    labelAsBuilt(tag, PROBE_BASE_IMAGE, {
      repo,
      dockerfile: 'Dockerfile',
      namespace: TEST_ORG_HANDLE,
      workflow: 'e2e-discovery',
    });

    try {
      const listRes = await request.get(catalogUrl(), { headers: apiKeyHeaders() });
      expect(listRes.ok(), await listRes.text()).toBe(true);
      const { entries } = (await listRes.json()) as { entries: EntryView[] };
      const discovered = entries.find((entry) => entry.source.repo === repo);

      expect(discovered, 'the image this namespace built is offered').toBeDefined();
      expect(discovered?.origin).toBe('discovered');
      // Named from the repo, described by nobody, and already carrying the
      // version the build produced — every fact but the sentence is derived.
      expect(discovered?.name).toBe(`e2e-discovered-${stamp}`);
      expect(discovered?.intent).toBe('');
      expect(discovered?.availability).toBe('present');
      expect(discovered?.versions.map((version) => version.imageTag)).toEqual([tag]);
      expect(discovered?.versions[0].workflow).toBe('e2e-discovery');

      // A discovered id resolves: a reader who clicks the row reaches the entry
      // the listing showed, rather than a 404 for a row that does not exist.
      const getRes = await request.get(
        `/api/image-catalog/${discovered?.id}?namespace=${TEST_ORG_HANDLE}`,
        { headers: apiKeyHeaders() },
      );
      expect(getRes.status(), await getRes.text()).toBe(200);
      const read = ((await getRes.json()) as { entry: EntryView }).entry;
      expect(read.origin).toBe('discovered');
      // Probed on the entry read, into the memo a row would otherwise hold —
      // a discovered entry derives every fact a catalogued one does.
      expect(read.versions[0].capabilities).toEqual({
        status: 'known',
        agentCapable: false,
        runtimes: [],
      });

      // Describing it is an ordinary create on the source it already carried,
      // and the id is derived from that source — so the row lands where the
      // discovered entry was, instead of beside it.
      const createRes = await request.post(catalogUrl(), {
        headers: apiKeyHeaders(),
        data: {
          name: 'E2E discovered image',
          intent: 'Proves an image the platform built is offered before anyone describes it',
          source: discovered?.source,
        },
      });
      expect(createRes.status(), await createRes.text()).toBe(201);
      const created = ((await createRes.json()) as { entry: EntryView }).entry;
      expect(created.id).toBe(discovered?.id);
      expect(created.origin).toBe('catalogued');
      // Describing is what probes it: the listing never does.
      expect(created.versions[0].capabilities.status).toBe('known');

      const afterRes = await request.get(catalogUrl(), { headers: apiKeyHeaders() });
      const after = (await afterRes.json()) as { entries: EntryView[] };
      const rows = after.entries.filter((entry) => entry.source.repo === repo);
      expect(rows).toHaveLength(1);
      expect(rows[0].origin).toBe('catalogued');

      await request.delete(`/api/image-catalog/${created.id}?namespace=${TEST_ORG_HANDLE}`, {
        headers: apiKeyHeaders(),
      });
    } finally {
      docker('rmi', '-f', tag);
    }
  });

  test('intent is rejected when empty, by the contract', async ({ request }) => {
    const res = await request.post(catalogUrl(), {
      headers: apiKeyHeaders(),
      data: { ...entryPayload(`no-intent-${Date.now()}`), intent: '' },
    });
    expect(res.status(), await res.text()).toBe(400);
  });

  test('the same source cannot be catalogued twice', async ({ request }) => {
    const payload = entryPayload(`dup-${Date.now()}`);
    const first = await request.post(catalogUrl(), { headers: apiKeyHeaders(), data: payload });
    expect(first.status()).toBe(201);
    const { entry } = (await first.json()) as { entry: EntryView };

    const dup = await request.post(catalogUrl(), {
      headers: apiKeyHeaders(),
      // Same source, spelled as the SSH URL — one image, one entry.
      data: {
        ...payload,
        source: { ...payload.source, repo: `git@github.com:${payload.source.repo}.git` },
      },
    });
    expect(dup.status(), await dup.text()).toBe(409);

    await request.delete(`/api/image-catalog/${entry.id}?namespace=${TEST_ORG_HANDLE}`, {
      headers: apiKeyHeaders(),
    });
  });

  test('the source is the key, so a PATCH that changes it re-keys the entry', async ({
    request,
  }) => {
    const payload = entryPayload(`rekey-${Date.now()}`);
    const createRes = await request.post(catalogUrl(), {
      headers: apiKeyHeaders(),
      data: payload,
    });
    const { entry } = (await createRes.json()) as { entry: EntryView };
    let liveId = entry.id;

    try {
      // A second Dockerfile in the same repository is a different image, so it
      // is a different key — this is the mistyped-source correction path.
      const res = await request.patch(
        `/api/image-catalog/${entry.id}?namespace=${TEST_ORG_HANDLE}`,
        {
          headers: apiKeyHeaders(),
          data: {
            source: {
              kind: 'built',
              repo: payload.source.repo,
              dockerfile: 'container/Dockerfile.gpu',
            },
          },
        },
      );
      expect(res.ok(), await res.text()).toBe(true);
      const moved = ((await res.json()) as { entry: EntryView }).entry;
      liveId = moved.id;

      expect(moved.id).not.toBe(entry.id);
      expect(moved.source.dockerfile).toBe('container/Dockerfile.gpu');
      // Carried across, so this is one entry moved rather than a fresh row the
      // caller has to describe again.
      expect(moved.name).toBe(payload.name);
      expect(moved.intent).toBe(payload.intent);

      // The old key is gone: the catalog cannot show the corrected entry beside
      // the mistake it replaced.
      const oldRead = await request.get(
        `/api/image-catalog/${entry.id}?namespace=${TEST_ORG_HANDLE}`,
        { headers: apiKeyHeaders() },
      );
      expect(oldRead.status()).toBe(404);

      const listRes = await request.get(catalogUrl(), { headers: apiKeyHeaders() });
      const ids = ((await listRes.json()) as { entries: EntryView[] }).entries.map(
        (candidate) => candidate.id,
      );
      expect(ids).toContain(moved.id);
      expect(ids).not.toContain(entry.id);
    } finally {
      await request.delete(`/api/image-catalog/${liveId}?namespace=${TEST_ORG_HANDLE}`, {
        headers: apiKeyHeaders(),
      });
    }
  });

  test('a plain member cannot delete an entry at all', async ({ request }) => {
    const payload = entryPayload(`rmi-gate-${Date.now()}`);
    const createRes = await request.post(catalogUrl(), {
      headers: apiKeyHeaders(),
      data: payload,
    });
    const { entry } = (await createRes.json()) as { entry: EntryView };

    try {
      // Deleting takes the images with it, and the daemon is deployment-wide —
      // so the whole act carries the workspace's admin gate, not only its
      // image half. Members may still create an entry.
      for (const url of [
        `/api/image-catalog/${entry.id}?namespace=${TEST_ORG_HANDLE}&withImages=true`,
        `/api/image-catalog/${entry.id}?namespace=${TEST_ORG_HANDLE}`,
      ]) {
        const refused = await request.delete(url, {
          headers: sessionCookieHeaders(plainMember),
        });
        expect(refused.status(), await refused.text()).toBe(403);
      }

      const stillThere = await request.get(
        `/api/image-catalog/${entry.id}?namespace=${TEST_ORG_HANDLE}`,
        { headers: apiKeyHeaders() },
      );
      expect(stillThere.ok(), await stillThere.text()).toBe(true);
    } finally {
      await request.delete(`/api/image-catalog/${entry.id}?namespace=${TEST_ORG_HANDLE}`, {
        headers: apiKeyHeaders(),
      });
    }
  });

  test('a live workflow version blocks the delete until it is archived', async ({ request }) => {
    test.skip(!dockerAvailable(), 'Docker daemon not available');
    const stamp = Date.now();
    const reference = `mediforce-e2e-pinned-${stamp}`;
    const tag = `${reference}:v1`;
    const workflowName = `e2e-pin-${stamp}`;
    let entryId = '';

    try {
      docker('image', 'inspect', PROBE_BASE_IMAGE);
    } catch {
      docker('pull', PROBE_BASE_IMAGE);
    }
    deriveImage(tag, PROBE_BASE_IMAGE, 'mkdir /e2e-pin-marker');

    try {
      const createRes = await request.post(catalogUrl(), {
        headers: apiKeyHeaders(),
        data: {
          name: `E2E pinned ${stamp}`,
          intent: 'Proves a live pin blocks the composite delete.',
          source: { kind: 'referenced', reference },
        },
      });
      expect(createRes.status(), await createRes.text()).toBe(201);
      entryId = ((await createRes.json()) as { entry: EntryView }).entry.id;

      const workflowRes = await request.post(
        `/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`,
        {
          headers: apiKeyHeaders(),
          data: {
            name: workflowName,
            title: `E2E Pin ${stamp}`,
            steps: [
              {
                id: 'analyse',
                name: 'Analyse',
                type: 'creation',
                executor: 'agent',
                autonomyLevel: 'L2',
                agent: { image: tag },
              },
              { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
            ],
            transitions: [{ from: 'analyse', to: 'done' }],
          },
        },
      );
      expect(workflowRes.status(), await workflowRes.text()).toBe(201);

      const blocked = await request.delete(
        `/api/image-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}&withImages=true`,
        { headers: apiKeyHeaders() },
      );
      // 409 and named, so the message is actionable rather than a bare refusal.
      expect(blocked.status(), await blocked.text()).toBe(409);
      expect(await blocked.text()).toContain(workflowName);

      // Nothing destroyed: the image is still on the daemon and the entry with it.
      docker('image', 'inspect', tag);

      // Archiving the version that pins it is the remedy — one version, not the
      // whole workflow.
      const archived = await request.post(
        `/api/workflow-definitions/${workflowName}/versions/1/archive?namespace=${TEST_ORG_HANDLE}`,
        { headers: apiKeyHeaders(), data: { archived: true } },
      );
      expect(archived.ok(), await archived.text()).toBe(true);

      const allowed = await request.delete(
        `/api/image-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}&withImages=true`,
        { headers: apiKeyHeaders() },
      );
      expect(allowed.ok(), await allowed.text()).toBe(true);
      expect(((await allowed.json()) as { deletedImages: string[] }).deletedImages).toEqual([tag]);
      entryId = '';
      expect(() => docker('image', 'inspect', tag)).toThrow();
    } finally {
      if (entryId !== '') {
        await request.delete(`/api/image-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`, {
          headers: apiKeyHeaders(),
        });
      }
      await request.delete(
        `/api/workflow-definitions/${workflowName}?namespace=${TEST_ORG_HANDLE}`,
        { headers: apiKeyHeaders() },
      );
      try {
        docker('rmi', '-f', tag);
      } catch {
        /* the delete under test removed it */
      }
    }
  });

  test('deleting with the images removes them from the daemon', async ({ request }) => {
    test.skip(!dockerAvailable(), 'Docker daemon not available');
    // A `docker commit` of its own, never a shared tag: this test destroys the
    // image it names, and a neighbour reading the same tag would lose it.
    const stamp = Date.now();
    const reference = `mediforce-e2e-rmi-${stamp}`;
    const tag = `${reference}:v1`;
    let entryId = '';

    try {
      docker('image', 'inspect', PROBE_BASE_IMAGE);
    } catch {
      docker('pull', PROBE_BASE_IMAGE);
    }
    deriveImage(tag, PROBE_BASE_IMAGE, 'mkdir /e2e-rmi-marker');

    try {
      const createRes = await request.post(catalogUrl(), {
        headers: apiKeyHeaders(),
        data: {
          name: `E2E rmi ${stamp}`,
          intent: 'Proves the composite delete reaches the daemon.',
          source: { kind: 'referenced', reference },
        },
      });
      expect(createRes.status(), await createRes.text()).toBe(201);
      entryId = ((await createRes.json()) as { entry: EntryView }).entry.id;

      const res = await request.delete(
        `/api/image-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}&withImages=true`,
        { headers: apiKeyHeaders() },
      );
      expect(res.ok(), await res.text()).toBe(true);
      // By tag, which is what the entry offered — not by image id, which a
      // second tag could still be pointing at.
      expect(((await res.json()) as { deletedImages: string[] }).deletedImages).toEqual([tag]);
      entryId = '';

      // The daemon is the assertion, not the response: `docker rmi` either ran
      // or it did not.
      expect(() => docker('image', 'inspect', tag)).toThrow();

      const listRes = await request.get(catalogUrl(), { headers: apiKeyHeaders() });
      const ids = ((await listRes.json()) as { entries: EntryView[] }).entries.map(
        (candidate) => candidate.id,
      );
      expect(ids).not.toContain(entryId);
    } finally {
      if (entryId !== '') {
        await request.delete(`/api/image-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`, {
          headers: apiKeyHeaders(),
        });
      }
      // Already gone when the test passed; this is for the paths where it is not.
      try {
        docker('rmi', '-f', tag);
      } catch {
        /* the delete under test removed it */
      }
    }
  });

  test('a re-key onto a source another entry already describes is refused', async ({
    request,
  }) => {
    const stamp = Date.now();
    const mine = entryPayload(`rekey-mine-${stamp}`);
    const theirs = entryPayload(`rekey-theirs-${stamp}`);
    const created = await Promise.all(
      [mine, theirs].map(async (data) => {
        const res = await request.post(catalogUrl(), { headers: apiKeyHeaders(), data });
        expect(res.status(), await res.text()).toBe(201);
        return ((await res.json()) as { entry: EntryView }).entry;
      }),
    );

    try {
      const res = await request.patch(
        `/api/image-catalog/${created[0].id}?namespace=${TEST_ORG_HANDLE}`,
        { headers: apiKeyHeaders(), data: { source: theirs.source } },
      );
      // 409, not a silent upsert: that would overwrite the occupant's own
      // sentence and delete the row being edited — two entries lost to one
      // edit.
      expect(res.status(), await res.text()).toBe(409);

      // Both rows survive, each still describing its own source.
      for (const existing of created) {
        const read = await request.get(
          `/api/image-catalog/${existing.id}?namespace=${TEST_ORG_HANDLE}`,
          { headers: apiKeyHeaders() },
        );
        expect(read.ok(), await read.text()).toBe(true);
        expect(((await read.json()) as { entry: EntryView }).entry.name).toBe(existing.name);
      }
    } finally {
      for (const existing of created) {
        await request.delete(`/api/image-catalog/${existing.id}?namespace=${TEST_ORG_HANDLE}`, {
          headers: apiKeyHeaders(),
        });
      }
    }
  });

  test('a member builds a version on demand and it lands under the entry', async ({ request }) => {
    test.skip(!dockerAvailable(), 'Docker daemon not available');
    // A clone plus a real `docker build`, on a daemon shared with every other
    // test in this file.
    test.setTimeout(300_000);

    const fixture = createBuildFixtureRepo();
    let entryId = '';
    let builtTag = '';
    try {
      // Catalogue the source first, so the assertion is that the build lands as
      // a *version of an entry an author already chose* — the property that
      // makes a rebuild an update rather than a new row (ADR-0022 decision 1).
      const createRes = await request.post(catalogUrl(), {
        headers: apiKeyHeaders(),
        data: {
          name: 'E2E on-demand build',
          intent: 'Proves a build with no workflow run lands in the catalog.',
          source: { kind: 'built', repo: fixture.repoUrl, dockerfile: 'Dockerfile' },
        },
      });
      expect(createRes.status(), await createRes.text()).toBe(201);
      entryId = ((await createRes.json()) as { entry: EntryView }).entry.id;

      // A plain member, not an admin: the build gate matches the create gate.
      const buildRes = await request.post(`/api/image-catalog/build?namespace=${TEST_ORG_HANDLE}`, {
        headers: sessionCookieHeaders(callers.member),
        data: { repo: fixture.repoUrl, commit: fixture.commit, dockerfile: 'Dockerfile' },
      });
      expect(buildRes.status(), await buildRes.text()).toBe(200);
      const built = (await buildRes.json()) as { imageTag: string; entryId: string };
      builtTag = built.imageTag;

      // The tag is the one a build-mode step pinning this commit would resolve
      // to, so that step finds this image cached instead of rebuilding it.
      expect(built.imageTag).toMatch(/^mediforce-built:[0-9a-f]{12}$/);
      expect(built.entryId).toBe(entryId);

      const getRes = await request.get(
        `/api/image-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`,
        { headers: apiKeyHeaders() },
      );
      expect(getRes.ok(), await getRes.text()).toBe(true);
      const { entry } = (await getRes.json()) as { entry: EntryView };
      expect(entry.availability).toBe('present');
      const version = entry.versions.find((candidate) => candidate.imageTag === built.imageTag);
      expect(version, `no version for ${built.imageTag}`).toBeDefined();
      // Provenance the *build* wrote, read back by the catalog with no help:
      // this is what makes the on-demand path indistinguishable from a step's.
      expect(version?.lineage.ownLabels['mediforce.build.commit']).toBe(fixture.commit);
    } finally {
      if (builtTag !== '') {
        try {
          docker('rmi', '-f', builtTag);
        } catch {
          // The build may not have produced it; the assertions already said so.
        }
      }
      if (entryId !== '') {
        await request.delete(`/api/image-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`, {
          headers: apiKeyHeaders(),
        });
      }
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  test('a caller from another namespace cannot build', async ({ request }) => {
    const buildRes = await request.post(`/api/image-catalog/build?namespace=${TEST_ORG_HANDLE}`, {
      headers: sessionCookieHeaders(callers.outsider),
      data: { repo: 'Appsilon/nope', commit: 'abc1234', dockerfile: 'Dockerfile' },
    });
    expect(buildRes.status()).toBe(403);
  });

  test('a caller from another namespace cannot see or write the catalog', async ({ request }) => {
    const payload = entryPayload(`isolation-${Date.now()}`);
    const createRes = await request.post(catalogUrl(), {
      headers: apiKeyHeaders(),
      data: payload,
    });
    const { entry } = (await createRes.json()) as { entry: EntryView };

    const outsiderHeaders = sessionCookieHeaders(callers.outsider);

    const listRes = await request.get(catalogUrl(), { headers: outsiderHeaders });
    expect(listRes.status()).toBe(403);

    const getRes = await request.get(
      `/api/image-catalog/${entry.id}?namespace=${TEST_ORG_HANDLE}`,
      { headers: outsiderHeaders },
    );
    expect(getRes.status()).toBe(403);

    const writeRes = await request.post(catalogUrl(), {
      headers: outsiderHeaders,
      data: entryPayload(`outsider-${Date.now()}`),
    });
    expect(writeRes.status()).toBe(403);

    // A plain member of the workspace — no admin role — reads and writes it.
    const memberHeaders = sessionCookieHeaders(callers.member);
    const memberList = await request.get(catalogUrl(), { headers: memberHeaders });
    expect(memberList.status(), await memberList.text()).toBe(200);
    const memberEntries = (await memberList.json()) as { entries: EntryView[] };
    expect(memberEntries.entries.map((e) => e.id)).toContain(entry.id);

    await request.delete(`/api/image-catalog/${entry.id}?namespace=${TEST_ORG_HANDLE}`, {
      headers: apiKeyHeaders(),
    });
  });
});
