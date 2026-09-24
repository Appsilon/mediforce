import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { carriedDockerfile, packBuildContextArchive, WorkflowDefinitionSchema } from '@mediforce/platform-core';
// The builder and the content hash a run uses. The `builds` sub-path, not the
// package index, which pulls in a plugin whose `import.meta` Playwright's
// loader cannot parse.
import {
  artifactsBuildHash,
  artifactsBuildTag,
  ensureImage,
  materializeArtifacts,
} from '@mediforce/agent-runtime/builds';
import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  OUTSIDER_NAMESPACE,
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
  contentHash?: string;
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
  source: {
    kind: string;
    repo?: string;
    dockerfile?: string;
    context?: string;
    reference?: string;
    workflow?: string;
  };
  declaredSource?: { repo?: string; commit?: string; dockerfile?: string };
  origin: 'catalogued' | 'discovered';
  versions: VersionView[];
  availability: 'present' | 'absent' | 'unknown';
  baseEntryId: string | null;
}

/** The image the capability probe runs against: `alpine` has busybox `sh` and
 *  none of the other probed runtimes, so its honest answer is `sh` alone and
 *  not agent-capable — offered to a `runtime: bash` step, which the engine runs
 *  as `sh` (#1377), and dropped by the agent picker. */
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
function deriveImage(tag: string, from: string, command: string, labels: Record<string, string> = {}): void {
  const container = `mediforce-e2e-lineage-${tag.replace(/[^a-z0-9]/gi, '-')}`;
  docker('run', '--name', container, from, ...command.split(' '));
  try {
    const changes = Object.entries(labels).flatMap(([key, value]) => ['--change', `LABEL ${key}=${value}`]);
    docker('commit', ...changes, container, tag);
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
function createBuildFixtureRepo(
  files: Record<string, string> = {
    Dockerfile: `FROM ${PROBE_BASE_IMAGE}\nRUN touch /built-on-demand\n`,
  },
): { repoUrl: string; commit: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mediforce-e2e-buildsrc-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
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
  git('add', '.');
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

/** A build context as the CLI and the Images view upload it: a tar archive of
 *  a folder, here a Dockerfile in `container/` that copies from `scripts/`. */
function uploadFixtureArchive(): Buffer {
  const encoder = new TextEncoder();
  return Buffer.from(
    packBuildContextArchive([
      {
        kind: 'file',
        path: 'container/Dockerfile',
        content: encoder.encode(`FROM ${PROBE_BASE_IMAGE}\nCOPY scripts/hello.sh /hello.sh\n`),
      },
      { kind: 'file', path: 'scripts/hello.sh', content: encoder.encode('echo hello\n'), executable: true },
    ]),
  );
}

/** `POST /api/image-catalog/upload` — the archive as a file, the rest as JSON.
 *  The shared helpers' JSON `Content-Type` is dropped so Playwright can set the
 *  multipart one, boundary included. */
function uploadContext(
  request: APIRequestContext,
  headers: Record<string, string>,
  input: Record<string, unknown>,
  archive: Buffer = uploadFixtureArchive(),
) {
  return request.post(`/api/image-catalog/upload?namespace=${TEST_ORG_HANDLE}`, {
    headers: Object.fromEntries(Object.entries(headers).filter(([name]) => name !== 'Content-Type')),
    multipart: {
      input: JSON.stringify(input),
      context: { name: 'context.tar', mimeType: 'application/x-tar', buffer: archive },
    },
  });
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
      runtimes: ['sh'],
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

  test('the listing probes an image in the background, once for every workspace', async ({ request }) => {
    test.skip(!dockerAvailable(), 'Docker daemon not available');
    // Catalogued in both workspaces before the image exists, so neither create
    // probes anything — the shape of a default image rebuilt on deploy.
    const reference = `mediforce-e2e-shared-probe-${Date.now()}`;
    const payload = {
      name: 'E2E shared probe image',
      intent: 'Proves one background probe answers every workspace',
      source: { kind: 'referenced', reference },
    };
    const outsiderHeaders = sessionCookieHeaders(callers.outsider);
    const testCreate = await request.post(catalogUrl(), { headers: apiKeyHeaders(), data: payload });
    expect(testCreate.status(), await testCreate.text()).toBe(201);
    const otherCreate = await request.post(catalogUrl(OUTSIDER_NAMESPACE), { headers: outsiderHeaders, data: payload });
    expect(otherCreate.status(), await otherCreate.text()).toBe(201);
    const { entry } = (await testCreate.json()) as { entry: EntryView };
    try {
      docker('image', 'inspect', PROBE_BASE_IMAGE);
    } catch {
      docker('pull', PROBE_BASE_IMAGE);
    }
    // A layer of its own, so its image id is one nothing has probed yet — a tag
    // of the base would share the id an earlier test already answered for.
    deriveImage(`${reference}:v1`, PROBE_BASE_IMAGE, `touch /${reference}`);

    const versionIn = async (namespace: string, headers: Record<string, string>) => {
      const res = await request.get(catalogUrl(namespace), { headers });
      expect(res.ok(), await res.text()).toBe(true);
      const { entries } = (await res.json()) as { entries: (EntryView & { versions: (VersionView & { capabilityProbe?: string })[] })[] };
      return entries.find((candidate) => candidate.id === entry.id)?.versions[0];
    };

    try {
      const first = await versionIn(TEST_ORG_HANDLE, apiKeyHeaders());
      expect(first?.capabilities).toEqual({ status: 'unknown' });
      expect(first?.capabilityProbe).toBe('pending');

      await expect
        .poll(async () => (await versionIn(TEST_ORG_HANDLE, apiKeyHeaders()))?.capabilities, { timeout: 30_000 })
        .toEqual({ status: 'known', agentCapable: false, runtimes: ['sh'] });
      // The other workspace was never listed while the probe ran, and still has
      // the answer on its first read.
      expect((await versionIn(OUTSIDER_NAMESPACE, outsiderHeaders))?.capabilities).toEqual({
        status: 'known',
        agentCapable: false,
        runtimes: ['sh'],
      });
    } finally {
      await request.delete(`/api/image-catalog/${entry.id}?namespace=${TEST_ORG_HANDLE}`, { headers: apiKeyHeaders() });
      await request.delete(`/api/image-catalog/${entry.id}?namespace=${OUTSIDER_NAMESPACE}`, { headers: outsiderHeaders });
      docker('rmi', `${reference}:v1`);
    }
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
        runtimes: ['sh'],
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

  test('a delete stays blocked until no runnable version pins the image', async ({ request }) => {
    test.skip(!dockerAvailable(), 'Docker daemon not available');
    const stamp = Date.now();
    // Under the workspace handle and labelled with it, as an upload is: only an
    // image this workspace produced leaves the daemon with its entry.
    const reference = `${TEST_ORG_HANDLE}/mediforce-e2e-pinned-${stamp}`;
    const tag = `${reference}:v1`;
    const workflowName = `e2e-pin-${stamp}`;
    let entryId = '';

    try {
      docker('image', 'inspect', PROBE_BASE_IMAGE);
    } catch {
      docker('pull', PROBE_BASE_IMAGE);
    }
    deriveImage(tag, PROBE_BASE_IMAGE, 'mkdir /e2e-pin-marker', { 'mediforce.build.namespace': TEST_ORG_HANDLE });

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

      // Two versions, both on the image: archiving the head hands runs back to
      // v1, so only archiving both clears the way.
      for (let registered = 0; registered < 2; registered += 1) {
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
      }

      const blocked = await request.delete(
        `/api/image-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}&withImages=true`,
        { headers: apiKeyHeaders() },
      );
      // 409 and named, so the message is actionable rather than a bare refusal.
      expect(blocked.status(), await blocked.text()).toBe(409);
      expect(await blocked.text()).toContain(workflowName);

      // Nothing destroyed: the image is still on the daemon and the entry with it.
      docker('image', 'inspect', tag);

      const archiveVersion = async (version: number) => {
        const archived = await request.post(
          `/api/workflow-definitions/${workflowName}/versions/${String(version)}/archive?namespace=${TEST_ORG_HANDLE}`,
          { headers: apiKeyHeaders(), data: { archived: true } },
        );
        expect(archived.ok(), await archived.text()).toBe(true);
      };

      // Archiving the head is not enough: runs fall back to v1, which pins the
      // same image, so deleting it would still break the next run.
      await archiveVersion(2);
      const stillBlocked = await request.delete(
        `/api/image-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}&withImages=true`,
        { headers: apiKeyHeaders() },
      );
      expect(stillBlocked.status(), await stillBlocked.text()).toBe(409);

      await archiveVersion(1);
      const allowed = await request.delete(
        `/api/image-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}&withImages=true`,
        { headers: apiKeyHeaders() },
      );
      expect(allowed.ok(), await allowed.text()).toBe(true);
      expect(((await allowed.json()) as { deletedImages: string[] }).deletedImages).toEqual([tag]);
      entryId = '';
      expect(() => docker('image', 'inspect', tag)).toThrow();

      // With every version archived the workflow is archived, not gone: the
      // catalog still lists it — marked archived — so it can be restored.
      const listRes = await request.get(
        `/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}&includeArchived=true`,
        { headers: apiKeyHeaders() },
      );
      expect(listRes.ok(), await listRes.text()).toBe(true);
      const listed = (
        (await listRes.json()) as {
          definitions: { name: string; definition: { archived?: boolean } | null }[];
        }
      ).definitions.find((group) => group.name === workflowName);
      expect(listed?.definition?.archived).toBe(true);
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

  /**
   * Admin -> Infrastructure's own delete, not the catalog's (#1375).
   *
   * Here rather than in a journey of its own because it destroys images on the
   * same deployment-wide daemon every test in this file reads, and one worker
   * running them in order is what keeps them from starving each other.
   */
  test('the infrastructure delete refuses an image a live version still runs on', async ({
    request,
  }) => {
    test.skip(!dockerAvailable(), 'Docker daemon not available');
    const stamp = Date.now();
    const tag = `mediforce-e2e-infra-rmi-${stamp}:v1`;
    const workflowName = `e2e-infra-pin-${stamp}`;

    try {
      docker('image', 'inspect', PROBE_BASE_IMAGE);
    } catch {
      docker('pull', PROBE_BASE_IMAGE);
    }
    deriveImage(tag, PROBE_BASE_IMAGE, 'mkdir /e2e-infra-marker');

    const rmi = (headers: Record<string, string>) =>
      request.delete('/api/admin/docker-images', { headers, data: { imageId: tag } });

    try {
      const workflowRes = await request.post(
        `/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`,
        {
          headers: apiKeyHeaders(),
          data: {
            name: workflowName,
            title: `E2E Infra Pin ${stamp}`,
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

      // The outsider owns their personal workspace and nothing else, which is
      // all the endpoint's own gate asks for — so before this check they could
      // destroy an image every step in `test` runs on.
      const outsiderRes = await rmi(sessionCookieHeaders(callers.outsider));
      expect(outsiderRes.status(), await outsiderRes.text()).toBe(409);
      const outsiderBody = await outsiderRes.text();
      // Blocked and told why, without being told whose private workflow it is.
      expect(outsiderBody).not.toContain(workflowName);
      expect(outsiderBody).toContain('cannot see');
      docker('image', 'inspect', tag);

      // A caller who may read the workflow gets it named, so the refusal is
      // actionable rather than a bare no.
      const namedRes = await rmi(apiKeyHeaders());
      expect(namedRes.status(), await namedRes.text()).toBe(409);
      expect(await namedRes.text()).toContain(`${TEST_ORG_HANDLE}/${workflowName} v1 (analyse)`);
      docker('image', 'inspect', tag);

      // Archived, so no run starts from it any more: an image nothing live
      // pins is reclaimable, which is the whole point of the `live` test.
      const archived = await request.post(
        `/api/workflow-definitions/${workflowName}/versions/1/archive?namespace=${TEST_ORG_HANDLE}`,
        { headers: apiKeyHeaders(), data: { archived: true } },
      );
      expect(archived.ok(), await archived.text()).toBe(true);

      const allowed = await rmi(apiKeyHeaders());
      expect(allowed.ok(), await allowed.text()).toBe(true);
      expect(() => docker('image', 'inspect', tag)).toThrow();
    } finally {
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
    // Under the workspace handle and labelled with it, as an upload is: only an
    // image this workspace produced leaves the daemon with its entry.
    const reference = `${TEST_ORG_HANDLE}/mediforce-e2e-rmi-${stamp}`;
    const tag = `${reference}:v1`;
    let entryId = '';

    try {
      docker('image', 'inspect', PROBE_BASE_IMAGE);
    } catch {
      docker('pull', PROBE_BASE_IMAGE);
    }
    deriveImage(tag, PROBE_BASE_IMAGE, 'mkdir /e2e-rmi-marker', { 'mediforce.build.namespace': TEST_ORG_HANDLE });

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

  test('deleting an adopted image removes the entry and keeps the image', async ({ request }) => {
    test.skip(!dockerAvailable(), 'Docker daemon not available');
    // No workspace prefix and no build label: an image that was on the daemon
    // before anyone catalogued it, which **Existing image** adopts. The daemon
    // is shared, so the entry is this workspace's to drop and the image is not.
    const stamp = Date.now();
    const reference = `mediforce-e2e-adopted-${stamp}`;
    const tag = `${reference}:v1`;
    let entryId = '';

    try {
      docker('image', 'inspect', PROBE_BASE_IMAGE);
    } catch {
      docker('pull', PROBE_BASE_IMAGE);
    }
    deriveImage(tag, PROBE_BASE_IMAGE, 'mkdir /e2e-adopted-marker');

    try {
      const createRes = await request.post(catalogUrl(), {
        headers: apiKeyHeaders(),
        data: {
          name: `E2E adopted ${stamp}`,
          intent: 'Proves an adopted image outlives its entry.',
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
      expect(await res.json()).toEqual({ success: true, deletedImages: [], keptImages: [tag] });
      entryId = '';

      docker('image', 'inspect', tag);
      const listRes = await request.get(catalogUrl(), { headers: apiKeyHeaders() });
      const references = ((await listRes.json()) as { entries: EntryView[] }).entries.map(
        (candidate) => candidate.source.reference,
      );
      expect(references).not.toContain(reference);
    } finally {
      if (entryId !== '') {
        await request.delete(`/api/image-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`, {
          headers: apiKeyHeaders(),
        });
      }
      try {
        docker('rmi', '-f', tag);
      } catch {
        /* never created */
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

  test('a Dockerfile in a subdirectory builds from a context that reaches its siblings', async ({
    request,
  }) => {
    test.skip(!dockerAvailable(), 'Docker daemon not available');
    test.setTimeout(300_000);

    // container/Dockerfile copies from scripts/ — outside its own directory, so
    // it only builds when the context is the repo root.
    const fixture = createBuildFixtureRepo({
      'container/Dockerfile': `FROM ${PROBE_BASE_IMAGE}\nCOPY scripts/hello.sh /hello.sh\n`,
      'scripts/hello.sh': 'echo hello\n',
    });
    let entryId = '';
    let builtTag = '';
    try {
      const createRes = await request.post(catalogUrl(), {
        headers: apiKeyHeaders(),
        data: {
          name: 'E2E context build',
          intent: 'Proves a subdirectory Dockerfile builds from a wider context.',
          source: { kind: 'built', repo: fixture.repoUrl, dockerfile: 'container/Dockerfile', context: '.' },
        },
      });
      expect(createRes.status(), await createRes.text()).toBe(201);
      const created = ((await createRes.json()) as { entry: EntryView }).entry;
      entryId = created.id;
      expect(created.source.context).toBe('.');

      const buildRes = await request.post(`/api/image-catalog/build?namespace=${TEST_ORG_HANDLE}`, {
        headers: apiKeyHeaders(),
        data: {
          repo: fixture.repoUrl,
          commit: fixture.commit,
          dockerfile: 'container/Dockerfile',
          context: '.',
        },
      });
      expect(buildRes.status(), await buildRes.text()).toBe(200);
      const built = (await buildRes.json()) as { imageTag: string; entryId: string };
      builtTag = built.imageTag;
      expect(built.entryId).toBe(entryId);

      const getRes = await request.get(
        `/api/image-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`,
        { headers: apiKeyHeaders() },
      );
      const { entry } = (await getRes.json()) as { entry: EntryView };
      const version = entry.versions.find((candidate) => candidate.imageTag === built.imageTag);
      expect(version, `no version for ${built.imageTag}`).toBeDefined();
      expect(version?.lineage.ownLabels['mediforce.build.context']).toBe('.');
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

  test('a member uploads a local build context and it lands as a referenced entry', async ({ request }) => {
    test.skip(!dockerAvailable(), 'Docker daemon not available');
    test.setTimeout(300_000);

    const reference = `${TEST_ORG_HANDLE}/e2e-upload-${Date.now()}`;
    let entryId = '';
    let builtTag = '';
    try {
      // A plain member, and no entry beforehand: the upload catalogues itself,
      // since discovery keys on a build repo an upload does not have.
      const uploadRes = await uploadContext(request, sessionCookieHeaders(plainMember), {
        reference,
        tag: 'v1',
        dockerfile: 'container/Dockerfile',
        intent: 'Proves a Dockerfile in no reachable repo can reach the catalog.',
        declaredSource: { repo: 'https://gitlab.example.com/team/agent', commit: 'bf0353b' },
      });
      expect(uploadRes.status(), await uploadRes.text()).toBe(200);
      const uploaded = (await uploadRes.json()) as { imageTag: string; entryId: string };
      builtTag = uploaded.imageTag;
      entryId = uploaded.entryId;
      expect(uploaded.imageTag).toBe(`${reference}:v1`);

      const getRes = await request.get(`/api/image-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`, {
        headers: apiKeyHeaders(),
      });
      expect(getRes.ok(), await getRes.text()).toBe(true);
      const { entry } = (await getRes.json()) as { entry: EntryView };
      // Referenced, with the provenance the uploader claimed and nothing derived.
      expect(entry.origin).toBe('catalogued');
      expect(entry.source).toEqual({ kind: 'referenced', reference });
      expect(entry.declaredSource).toEqual({ repo: 'https://gitlab.example.com/team/agent', commit: 'bf0353b' });
      const version = entry.versions.find((candidate) => candidate.imageTag === uploaded.imageTag);
      expect(version, `no version for ${uploaded.imageTag}`).toBeDefined();
      expect(version?.lineage.ownLabels['mediforce.build.namespace']).toBe(TEST_ORG_HANDLE);
      // Blanked, never inherited: an upload is not a platform build of any repo.
      expect(version?.lineage.ownLabels['mediforce.build.repo']).toBe('');

      // The siblings of the Dockerfile made it in, so the whole folder did.
      const hello = execFileSync('docker', ['run', '--rm', uploaded.imageTag, 'sh', '/hello.sh'], {
        stdio: 'pipe',
      })
        .toString()
        .trim();
      expect(hello).toBe('hello');

      // A version is never replaced: a step pinning it would change silently.
      const again = await uploadContext(request, sessionCookieHeaders(plainMember), {
        reference,
        tag: 'v1',
        dockerfile: 'container/Dockerfile',
      });
      expect(again.status(), await again.text()).toBe(409);
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
    }
  });

  test("a workflow's carried Dockerfile is offered, protected by its pin, and publishable", async ({ request }) => {
    test.skip(!dockerAvailable(), 'Docker daemon not available');
    test.setTimeout(300_000);

    const stamp = Date.now();
    const workflowName = `e2e-carried-${stamp}`;
    const reference = `${TEST_ORG_HANDLE}/e2e-carried-${stamp}`;
    const cleanupTags: string[] = [];
    let publishedEntryId = '';
    try {
      const registerRes = await request.post(`/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`, {
        headers: apiKeyHeaders(),
        data: {
          name: workflowName,
          title: `E2E Carried ${stamp}`,
          // The Dockerfile copies from a directory beside its own, which works
          // because the whole carried set is the context — as it is for an
          // uploaded folder.
          artifacts: [
            { path: 'container/Dockerfile', contents: `FROM ${PROBE_BASE_IMAGE}\nCOPY scripts/hello.sh /hello.sh\n` },
            { path: 'scripts/hello.sh', contents: 'echo carried\n' },
          ],
          steps: [
            {
              id: 'hello',
              name: 'Hello',
              type: 'creation',
              executor: 'script',
              plugin: 'script-container',
              script: { dockerfile: 'container/Dockerfile', command: 'sh /hello.sh' },
            },
            { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
          ],
          transitions: [{ from: 'hello', to: 'done' }],
        },
      });
      expect(registerRes.status(), await registerRes.text()).toBe(201);

      // Built by the platform's own builder, from the registered definition and
      // under the tag a run derives — nobody catalogues anything.
      const definitionRes = await request.get(
        `/api/workflow-definitions/${workflowName}?namespace=${TEST_ORG_HANDLE}`,
        { headers: apiKeyHeaders() },
      );
      expect(definitionRes.ok(), await definitionRes.text()).toBe(true);
      const definition = WorkflowDefinitionSchema.parse(((await definitionRes.json()) as { definition: unknown }).definition);
      const config = definition.steps[0].script;
      const dockerfile = carriedDockerfile(config, definition.artifacts);
      if (config === undefined || dockerfile === null || definition.artifacts === undefined) {
        throw new Error('the registered step does not build from its carried Dockerfile');
      }
      const build = { dockerfile, workflow: definition.name, namespace: definition.namespace };
      const carriedTag = artifactsBuildTag(definition.artifacts, build);
      const contentHash = artifactsBuildHash(definition.artifacts, build);
      cleanupTags.push(carriedTag);
      const contextDir = await materializeArtifacts(definition.artifacts);
      await ensureImage({
        image: carriedTag,
        contextDir: contextDir ?? '',
        dockerfile: config.dockerfile,
        artifactsHash: contentHash,
        workflow: definition.name,
        namespace: definition.namespace,
      });

      const listRes = await request.get(catalogUrl(), { headers: apiKeyHeaders() });
      const { entries } = (await listRes.json()) as { entries: EntryView[] };
      const carried = entries.find((entry) => entry.source.workflow === workflowName);
      expect(carried, 'the image the workflow built is offered').toBeDefined();
      expect(carried?.origin).toBe('discovered');
      expect(carried?.source).toEqual({ kind: 'carried', workflow: workflowName, dockerfile: 'container/Dockerfile' });
      expect(carried?.versions.map((version) => version.imageTag)).toEqual([carriedTag]);
      expect(carried?.versions[0].contentHash).toBe(contentHash);

      // The live version pins the carried tag, so its images cannot be deleted
      // from under it.
      const blocked = await request.delete(
        `/api/image-catalog/${carried?.id}?namespace=${TEST_ORG_HANDLE}&withImages=true`,
        { headers: apiKeyHeaders() },
      );
      expect(blocked.status(), await blocked.text()).toBe(409);
      expect(await blocked.text()).toContain(workflowName);

      // Published by a plain member, as an upload is.
      const publishRes = await request.post(
        `/api/image-catalog/${carried?.id}/publish?namespace=${TEST_ORG_HANDLE}`,
        {
          headers: sessionCookieHeaders(plainMember),
          data: {
            imageTag: carriedTag,
            reference,
            tag: 'v1',
            intent: 'Proves a carried image can outlive the workflow that built it.',
          },
        },
      );
      expect(publishRes.status(), await publishRes.text()).toBe(200);
      const published = (await publishRes.json()) as { imageTag: string; entryId: string };
      publishedEntryId = published.entryId;
      cleanupTags.push(published.imageTag);
      expect(published.imageTag).toBe(`${reference}:v1`);
      const hello = execFileSync('docker', ['run', '--rm', published.imageTag, 'sh', '/hello.sh'], { stdio: 'pipe' })
        .toString()
        .trim();
      expect(hello).toBe('carried');

      const afterRes = await request.get(catalogUrl(), { headers: apiKeyHeaders() });
      const after = ((await afterRes.json()) as { entries: EntryView[] }).entries;
      expect(after.find((entry) => entry.id === published.entryId)?.source).toEqual({ kind: 'referenced', reference });
      // Its labels were blanked, so it is not also a version of the carried entry.
      expect(
        after.find((entry) => entry.id === carried?.id)?.versions.map((version) => version.imageTag),
      ).toEqual([carriedTag]);
    } finally {
      if (publishedEntryId !== '') {
        await request.delete(`/api/image-catalog/${publishedEntryId}?namespace=${TEST_ORG_HANDLE}`, {
          headers: apiKeyHeaders(),
        });
      }
      await request.delete(`/api/workflow-definitions/${workflowName}?namespace=${TEST_ORG_HANDLE}`, {
        headers: apiKeyHeaders(),
      });
      for (const tag of cleanupTags) {
        try {
          docker('rmi', '-f', tag);
        } catch {
          // Never built; the assertions already said so.
        }
      }
    }
  });

  test('an upload that cannot build is refused before it reaches the daemon', async ({ request }) => {
    const reference = `${TEST_ORG_HANDLE}/e2e-refused-${Date.now()}`;

    // Outside the workspace's name: the daemon is shared by every workspace.
    const outside = await uploadContext(request, apiKeyHeaders(), {
      reference: 'postgres',
      dockerfile: 'container/Dockerfile',
      intent: 'Must never be built.',
    });
    expect(outside.status(), await outside.text()).toBe(400);

    // No Dockerfile where it was said to be — named, not a failed build.
    const missing = await uploadContext(request, apiKeyHeaders(), {
      reference,
      dockerfile: 'Dockerfile',
      intent: 'Must never be built.',
    });
    expect(missing.status(), await missing.text()).toBe(400);
    const refusal = (await missing.json()) as { error: { message: string } };
    expect(refusal.error.message).toContain('No Dockerfile at "Dockerfile"');

    // Not multipart at all: said so, rather than blamed on the size limit.
    const json = await request.post(`/api/image-catalog/upload?namespace=${TEST_ORG_HANDLE}`, {
      headers: apiKeyHeaders(),
      data: { reference, dockerfile: 'Dockerfile' },
    });
    expect(json.status(), await json.text()).toBe(400);

    // Not an archive at all.
    const garbage = await uploadContext(
      request,
      apiKeyHeaders(),
      { reference, dockerfile: 'Dockerfile', intent: 'Must never be built.' },
      Buffer.from('FROM alpine\n'),
    );
    expect(garbage.status(), await garbage.text()).toBe(400);

    // Nothing was catalogued by any of them.
    const listRes = await request.get(catalogUrl(), { headers: apiKeyHeaders() });
    const { entries } = (await listRes.json()) as { entries: EntryView[] };
    expect(entries.some((entry) => entry.source.reference === reference)).toBe(false);
  });

  test('a build context or Dockerfile outside the repository is refused by the contract', async ({
    request,
  }) => {
    const contextRes = await request.post(`/api/image-catalog/build?namespace=${TEST_ORG_HANDLE}`, {
      headers: apiKeyHeaders(),
      data: { repo: 'Appsilon/nope', commit: 'abc1234', dockerfile: 'Dockerfile', context: '../..' },
    });
    expect(contextRes.status(), await contextRes.text()).toBe(400);

    // A 400, not a 500 from a build that failed on it.
    const dockerfileRes = await request.post(`/api/image-catalog/build?namespace=${TEST_ORG_HANDLE}`, {
      headers: apiKeyHeaders(),
      data: { repo: 'Appsilon/nope', commit: 'abc1234', dockerfile: '../../Dockerfile', context: 'app' },
    });
    expect(dockerfileRes.status(), await dockerfileRes.text()).toBe(400);

    const createRes = await request.post(catalogUrl(), {
      headers: apiKeyHeaders(),
      data: {
        name: 'E2E escaping source',
        intent: 'Must never be stored.',
        source: { kind: 'built', repo: 'Appsilon/nope', dockerfile: '../../Dockerfile', context: 'app' },
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(400);
  });

  test('a member pulls a registry image and it lands as a referenced entry', async ({ request }) => {
    test.skip(!dockerAvailable(), 'Docker daemon not available');
    test.setTimeout(300_000);

    // A tag of the probe base, so the layers are already here and the pull is
    // a manifest fetch. Written the long way to prove the name is stored the
    // way the daemon lists it.
    const pulledTag = 'alpine:3.22.0';
    try {
      docker('rmi', pulledTag);
    } catch {
      // Not on the daemon, which is the state this test needs.
    }
    let entryId = '';
    try {
      const pullRes = await request.post(`/api/image-catalog/pull?namespace=${TEST_ORG_HANDLE}`, {
        headers: sessionCookieHeaders(plainMember),
        data: {
          reference: 'docker.io/library/alpine',
          tag: '3.22.0',
          intent: 'Proves a registry image reaches the catalog with no host shell.',
        },
      });
      expect(pullRes.status(), await pullRes.text()).toBe(200);
      const pulled = (await pullRes.json()) as { imageTag: string; entryId: string };
      entryId = pulled.entryId;
      expect(pulled.imageTag).toBe(pulledTag);
      docker('image', 'inspect', pulledTag);

      const getRes = await request.get(`/api/image-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`, {
        headers: apiKeyHeaders(),
      });
      expect(getRes.ok(), await getRes.text()).toBe(true);
      const { entry } = (await getRes.json()) as { entry: EntryView };
      expect(entry.source).toEqual({ kind: 'referenced', reference: 'alpine' });
      expect(entry.versions.map((version) => version.imageTag)).toContain(pulledTag);

      // A version is never replaced, by a pull any more than by an upload.
      const again = await request.post(`/api/image-catalog/pull?namespace=${TEST_ORG_HANDLE}`, {
        headers: sessionCookieHeaders(plainMember),
        data: { reference: 'alpine', tag: '3.22.0' },
      });
      expect(again.status(), await again.text()).toBe(409);
    } finally {
      try {
        docker('rmi', pulledTag);
      } catch {
        // The pull may not have produced it; the assertions already said so.
      }
      if (entryId !== '') {
        await request.delete(`/api/image-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`, {
          headers: apiKeyHeaders(),
        });
      }
    }
  });

  test("a pull cannot land on a name another workspace owns, or come from outside the workspace", async ({
    request,
  }) => {
    const foreign = await request.post(`/api/image-catalog/pull?namespace=${TEST_ORG_HANDLE}`, {
      headers: sessionCookieHeaders(plainMember),
      data: { reference: `${OUTSIDER_NAMESPACE}/agent`, tag: 'v1', intent: 'Not ours to pull.' },
    });
    expect(foreign.status(), await foreign.text()).toBe(403);
    const { error } = (await foreign.json()) as { error: { message: string } };
    expect(error.message).toContain(`belongs to workspace "${OUTSIDER_NAMESPACE}"`);

    const outsider = await request.post(`/api/image-catalog/pull?namespace=${TEST_ORG_HANDLE}`, {
      headers: sessionCookieHeaders(callers.outsider),
      data: { reference: 'alpine', tag: '3.22', intent: 'Not a member.' },
    });
    expect(outsider.status()).toBe(403);

    const tagged = await request.post(`/api/image-catalog/pull?namespace=${TEST_ORG_HANDLE}`, {
      headers: sessionCookieHeaders(plainMember),
      data: { reference: 'alpine:3.22', intent: 'The tag goes in its own field.' },
    });
    expect(tagged.status()).toBe(400);
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
