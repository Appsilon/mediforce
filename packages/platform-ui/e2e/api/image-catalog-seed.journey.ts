import type { APIRequestContext } from '@playwright/test';
import { DEFAULT_IMAGE_CATALOG_ENTRIES } from '@mediforce/platform-core';
import type { ImageCatalogEntryView } from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
import { createTestUser, signInAndGetSessionCookie } from '../helpers/emulator';
import { apiKeyHeaders, sessionCookieHeaders, type UserCaller } from '../helpers/multi-namespace';

/**
 * L3 API journey for seeding a new workspace's Image Catalog (#1376).
 *
 * A workspace used to be born with an empty catalog, which dropped the step
 * editor's picker to the raw deployment-wide daemon listing — and the first
 * entry anyone catalogued by hand flipped it to that one image. Both creation
 * paths now seed the images a step falls back to when it names none, so this
 * runs both for real: `POST /api/namespaces` and the personal workspace
 * `GET /api/users/me` bootstraps on first sign-in.
 *
 * Nothing here touches the daemon. The seed writes rows without probing, which
 * is exactly why a deployment with no reachable daemon still gets its catalog —
 * the entries carry no versions until a daemon holds the images.
 */

const SEED_USER_EMAIL = 'img-seed@mediforce.dev';
const SEED_USER_PASSWORD = 'imageseedjourney123456';
const ORG_HANDLE = 'img-seed-org';

let owner: UserCaller;

async function listCatalog(request: APIRequestContext, handle: string): Promise<ImageCatalogEntryView[]> {
  const res = await request.get(`/api/image-catalog?namespace=${handle}`, {
    headers: apiKeyHeaders(),
  });
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { entries: ImageCatalogEntryView[] }).entries;
}

/** The seeded rows, in a comparable shape — a discovered entry from an image
 *  the daemon happens to hold is not one of them. */
function catalogued(entries: ImageCatalogEntryView[]): { name: string; intent: string; reference?: string }[] {
  return entries
    .filter((entry) => entry.origin === 'catalogued')
    .map((entry) => ({ name: entry.name, intent: entry.intent, reference: entry.source.reference }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const EXPECTED = DEFAULT_IMAGE_CATALOG_ENTRIES.map((seed) => ({
  name: seed.reference,
  intent: seed.intent,
  reference: seed.reference,
})).sort((a, b) => a.name.localeCompare(b.name));

test.describe('A new workspace is born with a catalog — API E2E', () => {
  test.beforeAll(async () => {
    const uid = await createTestUser(SEED_USER_EMAIL, SEED_USER_PASSWORD, 'Image Seed Owner');
    owner = {
      uid,
      sessionCookie: await signInAndGetSessionCookie(SEED_USER_EMAIL, SEED_USER_PASSWORD),
    };
  });

  test('the personal workspace bootstrapped on first sign-in carries the defaults', async ({ request }) => {
    const me = await request.get('/api/users/me', { headers: sessionCookieHeaders(owner) });
    expect(me.status(), await me.text()).toBe(200);
    const personal = ((await me.json()) as { namespaces: { handle: string; type: string }[] }).namespaces
      .find((namespace) => namespace.type === 'personal');
    if (personal === undefined) throw new Error('first getMe did not bootstrap a personal workspace');

    expect(catalogued(await listCatalog(request, personal.handle))).toEqual(EXPECTED);
  });

  test('an organization workspace carries, protects, and restores its defaults', async ({ request }) => {
    await request.delete(`/api/namespaces/${ORG_HANDLE}`, { headers: apiKeyHeaders() });
    const created = await request.post('/api/namespaces', {
      headers: sessionCookieHeaders(owner),
      data: { handle: ORG_HANDLE, displayName: 'Image Seed Org' },
    });
    expect(created.status(), await created.text()).toBe(201);

    const entries = await listCatalog(request, ORG_HANDLE);
    expect(catalogued(entries)).toEqual(EXPECTED);
    expect(
      entries.filter((entry) => entry.origin === 'catalogued').every((entry) => entry.source.kind === 'referenced'),
    ).toBe(true);
    const pythonRuntime = entries.find(
      (entry) => entry.source.kind === 'referenced' && entry.source.reference === 'python',
    );
    if (pythonRuntime === undefined) throw new Error('expected a seeded python entry');

    // The daemon is deployment-wide and a `runtime: python` step pins nothing,
    // so the live-pin check cannot see what removing the image would break: it
    // stays, and the row — the workspace's own (decision 3) — goes.
    const withImages = await request.delete(
      `/api/image-catalog/${pythonRuntime.id}?namespace=${ORG_HANDLE}&withImages=true`,
      { headers: sessionCookieHeaders(owner) },
    );
    expect(withImages.status(), await withImages.text()).toBe(200);
    expect(((await withImages.json()) as { deletedImages: string[] }).deletedImages).toEqual([]);
    expect(
      (await listCatalog(request, ORG_HANDLE)).some((entry) => entry.id === pythonRuntime.id),
    ).toBe(false);

    const seed = await request.post(`/api/image-catalog/seed?namespace=${ORG_HANDLE}`, {
      headers: sessionCookieHeaders(owner),
    });
    expect(seed.status(), await seed.text()).toBe(200);
    // One row was deleted above and the other four are untouched, so a re-seed
    // reports the one write it made rather than all five defaults.
    expect((await seed.json()).seeded).toBe(1);

    expect(catalogued(await listCatalog(request, ORG_HANDLE))).toEqual(EXPECTED);
  });
});
