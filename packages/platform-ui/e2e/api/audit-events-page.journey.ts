import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  sessionCookieHeaders,
  setupMultiNamespaceCallers,
  TEST_ORG_HANDLE,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

/**
 * L3 API E2E for `GET /api/audit-events` — the extended, keyset-paginated
 * namespace audit feed backing the Monitoring → Users / Tasks tabs
 * (`ListNamespaceAuditEventsInputSchema` in
 * `packages/platform-api/src/contract/processes.ts`). Unlike the runs/
 * agent-runs endpoints, `namespace` is REQUIRED here (mirrors `/api/runs/names`).
 *
 * The wire query param is `action` (repeated); the handler input field is
 * `actions` — see `route.ts`'s `params.getAll('action')`.
 *
 * The 3 seeded events (`buildSeedData` → `seed-data.ts`) all carry the
 * unique `actorId: 'audit-page-journey-actor'`, so filtering on `actorId`
 * isolates exactly these 3 rows from whatever parallel journeys are doing
 * to other audit events under the shared `test` namespace.
 */

const ACTOR_ID = 'audit-page-journey-actor';
const EVENT_1 = 'Page journey fixture event 1'; // oldest, action: user.signed_in
const EVENT_2 = 'Page journey fixture event 2'; // action: user.signed_in
const EVENT_3 = 'Page journey fixture event 3'; // newest, action: task.completed

function auditEventsUrl(params: Record<string, string> = {}): string {
  const search = new URLSearchParams({ namespace: TEST_ORG_HANDLE, actorId: ACTOR_ID, ...params });
  return `/api/audit-events?${search.toString()}`;
}

test.describe('GET /api/audit-events — API E2E', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('api-key caller: 200 with all 3 seeded events, newest-first by timestamp', async ({ request }) => {
    const res = await request.get(auditEventsUrl(), { headers: apiKeyHeaders() });
    expect(res.status(), await res.text()).toBe(200);

    const body = (await res.json()) as { events: Array<{ description: string; actorId: string }>; nextCursor?: string };
    expect(body.events.map((event) => event.description)).toEqual([EVENT_3, EVENT_2, EVENT_1]);
    expect(body.nextCursor).toBeUndefined();
    for (const event of body.events) {
      expect(event.actorId).toBe(ACTOR_ID);
    }
  });

  test('cursor pagination: limit=2 walks all 3 rows across 2 pages with no duplicates, last page has no nextCursor', async ({ request }) => {
    const page1Res = await request.get(auditEventsUrl({ limit: '2' }), { headers: apiKeyHeaders() });
    expect(page1Res.status(), await page1Res.text()).toBe(200);
    const page1 = (await page1Res.json()) as { events: Array<{ description: string }>; nextCursor?: string };
    expect(page1.events.map((event) => event.description)).toEqual([EVENT_3, EVENT_2]);
    expect(page1.nextCursor).toBeDefined();

    const page2Res = await request.get(auditEventsUrl({ limit: '2', cursor: page1.nextCursor! }), {
      headers: apiKeyHeaders(),
    });
    expect(page2Res.status(), await page2Res.text()).toBe(200);
    const page2 = (await page2Res.json()) as { events: Array<{ description: string }>; nextCursor?: string };
    expect(page2.events.map((event) => event.description)).toEqual([EVENT_1]);
    expect(page2.nextCursor).toBeUndefined();

    const seenDescriptions = [...page1.events, ...page2.events].map((event) => event.description);
    expect(new Set(seenDescriptions).size).toBe(seenDescriptions.length);
  });

  test('action filter (repeated query param) narrows to the matching event only', async ({ request }) => {
    const res = await request.get(auditEventsUrl({ action: 'task.completed' }), { headers: apiKeyHeaders() });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { events: Array<{ description: string }> };
    expect(body.events.map((event) => event.description)).toEqual([EVENT_3]);
  });

  test('non-member caller: empty list, NOT a 403 (intersection semantics)', async ({ request }) => {
    const res = await request.get(auditEventsUrl(), { headers: sessionCookieHeaders(callers.outsider) });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(body.events).toEqual([]);
  });

  test('missing namespace query param → 400', async ({ request }) => {
    const res = await request.get('/api/audit-events', { headers: apiKeyHeaders() });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation');
  });
});
