import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { createTestUser, signInAndGetSessionCookie } from '../helpers/emulator';
import {
  clearPostgresWorkspaceMembership,
  seedPostgresOrganizationNamespace,
} from '../helpers/postgres-seed';
import { apiKeyHeaders, sessionCookieHeaders, TEST_USER_ID, type UserCaller } from '../helpers/multi-namespace';

/**
 * API-level journey for domain-based auto-join (`AUTO_JOIN_WORKSPACES`).
 *
 * The whole feature is a membership row written from `GET /api/users/me`, so
 * these run against the real server env: playwright.config.ts sets the rule
 * `autojoin.mediforce.dev:autojoin-journey-org` on the primary web server.
 *
 * What only shows up at this level: `getNamespace`'s anti-enumeration 404 is
 * the actual gate a non-member hits, and `caller.namespaces` is rebuilt from
 * Postgres per request — so "member row written" and "workspace now reachable"
 * are two different claims and both are asserted here.
 *
 * Runs serial: every test drives the same user through join → remove → rejoin,
 * and a parallel peer would race the membership row they share.
 */
test.describe.configure({ mode: 'serial' });

const ORG_HANDLE = 'autojoin-journey-org';
const JOINER_EMAIL = 'joiner@autojoin.mediforce.dev';
const JOINER_PASSWORD = 'autojoinjourney123456';
const OUTSIDER_EMAIL = 'outsider@not-autojoin.mediforce.dev';
const OUTSIDER_PASSWORD = 'autojoinoutsider123456';

let joiner: UserCaller;
let outsider: UserCaller;

async function callGetMe(request: APIRequestContext, user: UserCaller) {
  const res = await request.get('/api/users/me', { headers: sessionCookieHeaders(user) });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as { namespaces: Array<{ handle: string; role: string }> };
}

async function namespaceStatus(request: APIRequestContext, user: UserCaller): Promise<number> {
  const res = await request.get(`/api/namespaces/${ORG_HANDLE}`, {
    headers: sessionCookieHeaders(user),
  });
  return res.status();
}

async function signIn(email: string, password: string, name: string): Promise<UserCaller> {
  const uid = await createTestUser(email, password, name);
  return { uid, sessionCookie: await signInAndGetSessionCookie(email, password) };
}

test.describe('Domain auto-join — API E2E', () => {
  test.beforeAll(async () => {
    await seedPostgresOrganizationNamespace(ORG_HANDLE, TEST_USER_ID, 'Auto Join Journey Org');
    joiner = await signIn(JOINER_EMAIL, JOINER_PASSWORD, 'Auto Join Joiner');
    outsider = await signIn(OUTSIDER_EMAIL, OUTSIDER_PASSWORD, 'Auto Join Outsider');
  });

  test('a matching-domain user is a stranger until getMe, then a member', async ({ request }) => {
    await clearPostgresWorkspaceMembership(ORG_HANDLE, joiner.uid);

    expect(await namespaceStatus(request, joiner)).toBe(404);

    const me = await callGetMe(request, joiner);

    expect(me.namespaces).toContainEqual(
      expect.objectContaining({ handle: ORG_HANDLE, role: 'member' }),
    );
    expect(await namespaceStatus(request, joiner)).toBe(200);
  });

  test('an out-of-domain user is never joined', async ({ request }) => {
    await clearPostgresWorkspaceMembership(ORG_HANDLE, outsider.uid);

    const me = await callGetMe(request, outsider);

    expect(me.namespaces.map((n) => n.handle)).not.toContain(ORG_HANDLE);
    expect(await namespaceStatus(request, outsider)).toBe(404);
  });

  test('a promotion survives the next getMe — auto-join never demotes', async ({ request }) => {
    const promote = await request.patch(
      `/api/namespaces/${ORG_HANDLE}/members/${joiner.uid}`,
      { headers: apiKeyHeaders(), data: { role: 'admin' } },
    );
    expect(promote.status(), await promote.text()).toBe(200);

    const me = await callGetMe(request, joiner);

    expect(me.namespaces).toContainEqual(
      expect.objectContaining({ handle: ORG_HANDLE, role: 'admin' }),
    );
  });

  test('removal sticks across getMe, and an explicit invite brings them back', async ({ request }) => {
    const removed = await request.delete(
      `/api/namespaces/${ORG_HANDLE}/members/${joiner.uid}`,
      { headers: apiKeyHeaders() },
    );
    expect(removed.status(), await removed.text()).toBe(200);

    const afterRemoval = await callGetMe(request, joiner);
    expect(afterRemoval.namespaces.map((n) => n.handle)).not.toContain(ORG_HANDLE);
    expect(await namespaceStatus(request, joiner)).toBe(404);

    const reinvited = await request.post('/api/users/invite', {
      headers: apiKeyHeaders(),
      data: { email: JOINER_EMAIL, namespaceHandle: ORG_HANDLE, role: 'member' },
    });
    expect(reinvited.status(), await reinvited.text()).toBe(201);

    expect(await namespaceStatus(request, joiner)).toBe(200);
  });
});
