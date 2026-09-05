import { execFileSync } from 'node:child_process';
import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  sessionCookieHeaders,
  setupMultiNamespaceCallers,
  TEST_ORG_HANDLE,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

/**
 * L3 API journey for the Image Catalog (ADR-0021, issue #1294). Runs against
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
}

interface EntryView {
  id: string;
  name: string;
  intent: string;
  source: { kind: string; repo?: string; dockerfile?: string; reference?: string };
  versions: VersionView[];
  availability: 'present' | 'absent' | 'unknown';
}

/** The image the capability probe runs against: `alpine` has a shell and none
 *  of the probed runtimes, so its honest answer is a known, empty set — the
 *  case the agent picker must drop rather than offer. */
const PROBE_BASE_IMAGE = 'alpine:3.22';

function docker(...args: string[]): void {
  execFileSync('docker', args, { stdio: 'pipe' });
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

test.describe('image catalog API journey', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
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

  test('the source is the key and cannot be re-pointed by a PATCH', async ({ request }) => {
    const payload = entryPayload(`rekey-${Date.now()}`);
    const createRes = await request.post(catalogUrl(), {
      headers: apiKeyHeaders(),
      data: payload,
    });
    const { entry } = (await createRes.json()) as { entry: EntryView };

    const res = await request.patch(
      `/api/image-catalog/${entry.id}?namespace=${TEST_ORG_HANDLE}`,
      {
        headers: apiKeyHeaders(),
        data: { source: { kind: 'referenced', reference: 'postgres' } },
      },
    );
    expect(res.status(), await res.text()).toBe(400);

    await request.delete(`/api/image-catalog/${entry.id}?namespace=${TEST_ORG_HANDLE}`, {
      headers: apiKeyHeaders(),
    });
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
