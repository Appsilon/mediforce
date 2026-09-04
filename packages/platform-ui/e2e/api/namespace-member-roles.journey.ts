import type { APIRequestContext } from '@playwright/test';
import { formatRoleGrant } from '@mediforce/platform-core';
import { test, expect } from '../helpers/test-fixtures';
import { createTestUser, signInAndGetSessionCookie } from '../helpers/emulator';
import { seedPostgresOrganizationNamespace } from '../helpers/postgres-seed';
import {
  apiKeyHeaders,
  sessionCookieHeaders,
  setupMultiNamespaceCallers,
  TEST_USER_ID,
  type MultiNamespaceFixture,
  type UserCaller,
} from '../helpers/multi-namespace';

/**
 * API-level journey for process-role assignment (ADR-0019, issue #1248).
 *
 * Before this, nothing could grant a role: `user_roles` was written only by a
 * one-time migration, and every workflow's `allowedRoles` named people who
 * could not exist. These tests cover the write path end to end — real Postgres,
 * real middleware, real session cookies — including the two cascades that are
 * silent when they go wrong.
 *
 * The workspace is owned by the shared test user. Handles, emails and uids are
 * fixed rather than timestamped: the seeds are `ON CONFLICT DO NOTHING`, so a
 * re-run reuses the rows instead of leaving a new set behind in the shared
 * database.
 *
 * Every test owns its own grant target, because the file runs in parallel: a
 * shared target would let one test's assignment race another's.
 */
const ORG_HANDLE = 'roles-journey-org';
const TEALFLOW = 'tealflow';

/** Member of ORG_HANDLE with the plain `member` seat — the 403 probe. */
const PLAIN_MEMBER_EMAIL = 'roles-journey-member@mediforce.dev';
const PLAIN_MEMBER_PASSWORD = 'rolesjourney123456';

let callers: MultiNamespaceFixture;
let plainMember: UserCaller;

/**
 * Seed a member of ORG_HANDLE through the real invite endpoint (idempotent on
 * email collision, so a re-run reuses the uid) and return their uid.
 */
async function inviteMember(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post('/api/users/invite', {
    headers: apiKeyHeaders(),
    data: { email, namespaceHandle: ORG_HANDLE, role: 'member' },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).uid;
}

/** A target that starts every test with no roles, whatever a previous run left. */
async function freshTarget(request: APIRequestContext, email: string): Promise<string> {
  const uid = await inviteMember(request, email);
  const reset = await request.put(
    `/api/namespaces/${ORG_HANDLE}/members/${uid}/roles`,
    { headers: apiKeyHeaders(), data: { grants: [] } },
  );
  expect(reset.status(), await reset.text()).toBe(200);
  return uid;
}

/** The roster's view of a member's grants, as `role` / `role@workflow`, sorted. */
async function rolesOf(request: APIRequestContext, uid: string): Promise<string[]> {
  const res = await request.get(`/api/users/members?namespace=${ORG_HANDLE}`, {
    headers: apiKeyHeaders(),
  });
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as {
    members: Array<{ uid: string; grants: Array<{ role: string; workflowName: string | null }> }>;
  };
  const member = body.members.find((row) => row.uid === uid);
  expect(member, `member ${uid} missing from the ${ORG_HANDLE} roster`).toBeDefined();
  return (member?.grants ?? []).map(formatRoleGrant).sort();
}

test.describe('Workspace process roles — API E2E', () => {
  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
    await seedPostgresOrganizationNamespace(ORG_HANDLE, TEST_USER_ID, 'Roles Journey Org');
    const uid = await createTestUser(
      PLAIN_MEMBER_EMAIL,
      PLAIN_MEMBER_PASSWORD,
      'Roles Journey Member',
    );
    plainMember = {
      uid,
      sessionCookie: await signInAndGetSessionCookie(PLAIN_MEMBER_EMAIL, PLAIN_MEMBER_PASSWORD),
    };
  });

  test('an owner assigns roles and reads them back on the member list', async ({ request }) => {
    const target = await freshTarget(request, 'roles-journey-assign@mediforce.dev');

    const res = await request.put(
      `/api/namespaces/${ORG_HANDLE}/members/${target}/roles`,
      {
        // The workspace owner's own session cookie, not the api key — the
        // owner/admin gate is what this asserts, and apiKey bypasses it.
        headers: sessionCookieHeaders(callers.member),
        data: {
          grants: [
            { role: 'reviewer', workflowName: null },
            { role: 'approver', workflowName: TEALFLOW },
          ],
        },
      },
    );
    expect(res.status(), await res.text()).toBe(200);

    // The roster reports both, each keeping the workflow it was narrowed to —
    // a plain member reads this list too, so it is the one place a colleague
    // can find out who the reviewer is, and the settings editor writes back a
    // full replace off exactly this read.
    expect(await rolesOf(request, target)).toEqual([`approver@${TEALFLOW}`, 'reviewer']);
  });

  test('a plain member cannot set anyone’s roles', async ({ request }) => {
    const target = await freshTarget(request, 'roles-journey-forbidden@mediforce.dev');
    await inviteMember(request, PLAIN_MEMBER_EMAIL);

    const res = await request.put(
      `/api/namespaces/${ORG_HANDLE}/members/${target}/roles`,
      {
        headers: sessionCookieHeaders(plainMember),
        data: { grants: [{ role: 'reviewer', workflowName: null }] },
      },
    );
    expect(res.status(), await res.text()).toBe(403);
    expect(await rolesOf(request, target)).toEqual([]);
  });

  test('a target who is not a member of the workspace is rejected', async ({ request }) => {
    // Roles compose with Membership by AND, so this grant would authorise
    // nothing — but it would survive, invisible, and take effect the day the
    // uid is added. The grant path refuses to create that row.
    const res = await request.put(
      `/api/namespaces/${ORG_HANDLE}/members/not-a-member-uid/roles`,
      { headers: apiKeyHeaders(), data: { grants: [{ role: 'reviewer', workflowName: null }] } },
    );
    expect(res.status(), await res.text()).toBe(404);
  });

  test('an empty grants array clears every role', async ({ request }) => {
    const target = await freshTarget(request, 'roles-journey-clear@mediforce.dev');

    const grant = await request.put(
      `/api/namespaces/${ORG_HANDLE}/members/${target}/roles`,
      { headers: apiKeyHeaders(), data: { grants: [{ role: 'reviewer', workflowName: null }] } },
    );
    expect(grant.status(), await grant.text()).toBe(200);
    expect(await rolesOf(request, target)).toEqual(['reviewer']);

    const clear = await request.put(
      `/api/namespaces/${ORG_HANDLE}/members/${target}/roles`,
      { headers: apiKeyHeaders(), data: { grants: [] } },
    );
    expect(clear.status(), await clear.text()).toBe(200);
    expect(await rolesOf(request, target)).toEqual([]);
  });

  test('removing a member drops their roles, so re-adding them restores nothing', async ({ request }) => {
    const email = 'roles-journey-cascade@mediforce.dev';
    const target = await freshTarget(request, email);

    const grant = await request.put(
      `/api/namespaces/${ORG_HANDLE}/members/${target}/roles`,
      { headers: apiKeyHeaders(), data: { grants: [{ role: 'reviewer', workflowName: null }] } },
    );
    expect(grant.status(), await grant.text()).toBe(200);
    expect(await rolesOf(request, target)).toEqual(['reviewer']);

    const remove = await request.delete(
      `/api/namespaces/${ORG_HANDLE}/members/${target}`,
      { headers: apiKeyHeaders() },
    );
    expect(remove.status(), await remove.text()).toBe(200);

    // The `namespace` FK cascades on workspace deletion, which is a different
    // event — nothing but the removal transaction drops this row. Left behind,
    // it silently reactivates here.
    const readded = await inviteMember(request, email);
    expect(readded).toBe(target);
    expect(await rolesOf(request, target)).toEqual([]);
  });
});
