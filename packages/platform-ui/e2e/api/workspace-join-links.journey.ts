import type { APIRequestContext } from '@playwright/test';
import postgres from 'postgres';
import { test, expect } from '../helpers/test-fixtures';
import { createTestUser, signInAndGetSessionCookie } from '../helpers/emulator';
import { seedPostgresOrganizationNamespace } from '../helpers/postgres-seed';
import {
  apiKeyHeaders,
  sessionCookieHeaders,
  setupMultiNamespaceCallers,
  TEST_ORG_HANDLE,
  TEST_USER_EMAIL,
  TEST_USER_ID,
  type MultiNamespaceFixture,
  type UserCaller,
} from '../helpers/multi-namespace';

/**
 * API-level journey for workspace join links (ADR-0021).
 *
 * The L2 handler tests run against an in-memory store; these run against real
 * Postgres, real middleware and real session cookies, which is where the three
 * things most likely to be wrong actually live: that `/api/join/*` is reachable
 * with **no credentials at all** (a joiner has none — the proxy exemption is
 * what makes the feature work, and a regression there is invisible to a unit
 * test), that a redemption writes a real `workspace_members` row, and that the
 * `FOR UPDATE` in `claim` holds a use cap under concurrency.
 *
 * Handles and emails are fixed rather than timestamped: the seeds are
 * `ON CONFLICT DO NOTHING`, so a re-run reuses the rows.
 */
const ORG_HANDLE = 'join-links-journey-org';
/**
 * The shared test user's own personal workspace — despite the constant's name,
 * `test` is seeded as `type: 'personal'`. Borrowed rather than seeded fresh: a
 * user has exactly one personal workspace, so a second one is a shape
 * production cannot produce, and the workspace picker renders every personal
 * workspace as "My workspace" and would then show two.
 */
const PERSONAL_HANDLE = TEST_ORG_HANDLE;

const PLAIN_MEMBER_EMAIL = 'join-links-journey-member@mediforce.dev';
const PLAIN_MEMBER_PASSWORD = 'joinlinksjourney123456';

let callers: MultiNamespaceFixture;
let plainMember: UserCaller;

interface MintedLink {
  token: string;
  url: string;
  link: { id: string; status: string; maxUses: number | null; uses: number };
}

async function mint(
  request: APIRequestContext,
  body: Record<string, unknown> = {},
): Promise<MintedLink> {
  const res = await request.post(`/api/namespaces/${ORG_HANDLE}/join-links`, {
    headers: apiKeyHeaders(),
    data: { expiresInDays: 7, ...body },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as MintedLink;
}

/**
 * Deliberately carries no api key and no session cookie: a joiner has neither,
 * and asserting the token alone gets through is the point.
 */
async function redeem(
  request: APIRequestContext,
  token: string,
  email: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request.post('/api/join/redeem', { data: { token, email } });
  return { status: res.status(), body: (await res.json()) as Record<string, unknown> };
}

async function membershipOf(uid: string): Promise<string | null> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set for this journey.');
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const rows = await sql<{ role: string }[]>`
      SELECT role FROM workspace_members WHERE workspace = ${ORG_HANDLE} AND uid = ${uid}
    `;
    return rows[0]?.role ?? null;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function seededUser(
  email: string,
): Promise<{ id: string; invitedAt: Date | null } | null> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set for this journey.');
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const rows = await sql<{ id: string; invited_at: Date | null }[]>`
      SELECT id, invited_at FROM auth_users WHERE email = ${email.toLowerCase()}
    `;
    const row = rows[0];
    return row === undefined ? null : { id: row.id, invitedAt: row.invited_at };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function uidForEmail(email: string): Promise<string | null> {
  return (await seededUser(email))?.id ?? null;
}

/**
 * Drop any account and membership a previous run left for `email`.
 *
 * The suite runs against a shared database and reuses fixed addresses, and
 * redemption is deliberately create-only — so a case asserting what a FIRST
 * redemption writes has to start from nothing, or it silently asserts against
 * a row some earlier run made.
 */
async function forgetUser(email: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set for this journey.');
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`
      DELETE FROM workspace_members
      WHERE uid IN (SELECT id FROM auth_users WHERE email = ${email.toLowerCase()})
    `;
    await sql`DELETE FROM auth_users WHERE email = ${email.toLowerCase()}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test.describe('Workspace join links — API E2E', () => {
  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
    await seedPostgresOrganizationNamespace(ORG_HANDLE, TEST_USER_ID, 'Join Links Journey Org');
    const uid = await createTestUser(
      PLAIN_MEMBER_EMAIL,
      PLAIN_MEMBER_PASSWORD,
      'Join Links Journey Member',
    );
    plainMember = {
      uid,
      sessionCookie: await signInAndGetSessionCookie(PLAIN_MEMBER_EMAIL, PLAIN_MEMBER_PASSWORD),
    };
  });

  test('an unauthenticated visitor previews a link and redeems it into a real membership', async ({
    request,
  }) => {
    const email = 'join-links-journey-newbie@mediforce.dev';
    await forgetUser(email);
    const minted = await mint(request);

    // No api key, no cookie — `proxy.ts` exempts `/api/join/*` because a joiner
    // cannot present a session while obtaining one.
    const preview = await request.post('/api/join/preview', { data: { token: minted.token } });
    expect(preview.status(), await preview.text()).toBe(200);
    expect(await preview.json()).toMatchObject({
      ok: true,
      namespaceHandle: ORG_HANDLE,
    });

    const redeemed = await redeem(request, minted.token, email);
    expect(redeemed.status).toBe(200);
    expect(redeemed.body).toMatchObject({ ok: true, namespaceHandle: ORG_HANDLE });

    const user = await seededUser(email);
    expect(user, 'redeeming must seed an auth_users row').not.toBeNull();
    expect(await membershipOf(user!.id)).toBe('member');
    // The link between this feature and the ADR-0021 §5 sign-in gate: a
    // redemption is a deliberate seeding, so it stamps `invited_at` and the
    // joiner can sign in whatever their email domain. Without this the joiner
    // is admitted to the workspace and then refused at the door — the exact
    // unusable-invite bug §5 exists to fix.
    expect(user!.invitedAt, 'redeeming must stamp invited_at').not.toBeNull();
  });

  test('the use cap holds even when two people redeem the last seat at once', async ({
    request,
  }) => {
    const minted = await mint(request, { maxUses: 1 });

    // `claim` takes the row FOR UPDATE before checking the cap. Without that
    // both requests read `uses = 0`, both pass, and the link admits two people
    // to a one-seat cohort.
    const [first, second] = await Promise.all([
      redeem(request, minted.token, 'join-links-journey-race-a@mediforce.dev'),
      redeem(request, minted.token, 'join-links-journey-race-b@mediforce.dev'),
    ]);

    const outcomes = [first.body.ok, second.body.ok].sort();
    expect(outcomes).toEqual([false, true]);
    const refused = first.body.ok === true ? second.body : first.body;
    expect(refused.reason).toBe('exhausted');
  });

  test('a revoked link refuses redemption but keeps everyone it already admitted', async ({
    request,
  }) => {
    const email = 'join-links-journey-revoked@mediforce.dev';
    await forgetUser(email);
    const minted = await mint(request);

    expect((await redeem(request, minted.token, email)).body.ok).toBe(true);
    const uid = await uidForEmail(email);
    expect(await membershipOf(uid as string)).toBe('member');

    const revoke = await request.delete(
      `/api/namespaces/${ORG_HANDLE}/join-links/${minted.link.id}`,
      { headers: apiKeyHeaders() },
    );
    expect(revoke.status(), await revoke.text()).toBe(200);

    const after = await redeem(request, minted.token, 'join-links-journey-too-late@mediforce.dev');
    expect(after.body).toEqual({ ok: false, reason: 'revoked' });
    // A link is an entrance, not a tenancy.
    expect(await membershipOf(uid as string)).toBe('member');
  });

  test('an already-joined address gets the identical answer to a stranger', async ({ request }) => {
    const minted = await mint(request, { maxUses: 10 });
    const email = 'join-links-journey-twice@mediforce.dev';

    const first = await redeem(request, minted.token, email);
    const second = await redeem(request, minted.token, email);
    const stranger = await redeem(
      request,
      minted.token,
      'join-links-journey-stranger@mediforce.dev',
    );

    expect(first.body).toEqual(second.body);
    expect(second.body).toEqual(stranger.body);
  });

  test('an unknown token is refused without a session and without seeding anything', async ({
    request,
  }) => {
    const email = 'join-links-journey-nobody@mediforce.dev';

    const redeemed = await redeem(request, 'not-a-real-token', email);

    expect(redeemed.status).toBe(200);
    expect(redeemed.body).toEqual({ ok: false, reason: 'not_found' });
    expect(await uidForEmail(email)).toBeNull();
  });

  /**
   * The redemption path is an unauthenticated write taking whatever email is
   * typed, so it must not be able to change anything that already exists.
   * Reproduced end to end through the real public route, because the guard that
   * stops it lives three layers down in `seedInvite` and the whole point is
   * that no layer above re-opens it.
   */
  test('redeeming against the owner’s address does not demote them', async ({ request }) => {
    const minted = await mint(request);

    const redeemed = await redeem(request, minted.token, TEST_USER_EMAIL);

    // Anti-enumeration holds: the answer is the ordinary success body.
    expect(redeemed.body.ok).toBe(true);
    // …and the owner still owns the workspace.
    expect(await membershipOf(TEST_USER_ID)).toBe('owner');
  });

  test('redeeming against an existing member leaves their seat untouched', async ({
    request,
  }) => {
    const email = 'join-links-journey-noescalate@mediforce.dev';
    await forgetUser(email);
    const seeded = await request.post('/api/users/invite', {
      headers: apiKeyHeaders(),
      data: { email, namespaceHandle: ORG_HANDLE, role: 'member' },
    });
    expect(seeded.status(), await seeded.text()).toBe(201);
    const uid = (await seeded.json()).uid as string;

    const minted = await mint(request);
    expect((await redeem(request, minted.token, email)).body.ok).toBe(true);

    expect(await membershipOf(uid)).toBe('member');
  });

  test('a plain member cannot mint, list, or revoke', async ({ request }) => {
    const minted = await mint(request);

    const create = await request.post(`/api/namespaces/${ORG_HANDLE}/join-links`, {
      headers: sessionCookieHeaders(plainMember),
      data: { expiresInDays: 7 },
    });
    const list = await request.get(`/api/namespaces/${ORG_HANDLE}/join-links`, {
      headers: sessionCookieHeaders(plainMember),
    });
    const revoke = await request.delete(
      `/api/namespaces/${ORG_HANDLE}/join-links/${minted.link.id}`,
      { headers: sessionCookieHeaders(plainMember) },
    );

    expect(create.status()).toBe(403);
    expect(list.status()).toBe(403);
    expect(revoke.status()).toBe(403);
  });

  test('the owner lists their links over a session cookie, and never sees a token', async ({
    request,
  }) => {
    const minted = await mint(request);

    const res = await request.get(`/api/namespaces/${ORG_HANDLE}/join-links`, {
      headers: sessionCookieHeaders(callers.member),
    });
    expect(res.status(), await res.text()).toBe(200);
    const text = await res.text();

    expect(text).toContain(minted.link.id);
    expect(text).not.toContain(minted.token);
  });

  test('a personal workspace cannot mint one', async ({ request }) => {
    const res = await request.post(`/api/namespaces/${PERSONAL_HANDLE}/join-links`, {
      headers: apiKeyHeaders(),
      data: { expiresInDays: 7 },
    });

    expect(res.status(), await res.text()).toBe(409);
  });
});
