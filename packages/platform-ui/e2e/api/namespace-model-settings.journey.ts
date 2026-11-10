import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { createTestUser, signInAndGetSessionCookie } from '../helpers/emulator';
import { seedPostgresOrganizationNamespace } from '../helpers/postgres-seed';
import { apiKeyHeaders, sessionCookieHeaders, TEST_USER_ID, type UserCaller } from '../helpers/multi-namespace';

/**
 * API-level journey for the model settings: the workspace output budget and
 * default model an owner or admin sets, and the ones a member sets for themselves.
 * Real Postgres, real middleware, real session cookies.
 *
 * Handles, emails and uids are fixed: the seeds are idempotent, so a re-run
 * reuses the rows. Each test sets the value it reads, whatever a previous run left.
 */
const ORG_HANDLE = 'model-settings-org';
const MEMBER_EMAIL = 'model-settings-member@mediforce.dev';
const MEMBER_PASSWORD = 'outputbudget123456';
const namespaceUrl = `/api/namespaces/${ORG_HANDLE}`;
const memberSettingsUrl = `${namespaceUrl}/model-settings`;
const LIVE_MODEL = 'openai/gpt-4o';

let member: UserCaller;

async function memberSettingsOf(request: APIRequestContext, uid: string): Promise<{ outputBudget?: string; defaultModel?: string }> {
  const res = await request.get(`/api/users/members?namespace=${ORG_HANDLE}`, { headers: apiKeyHeaders() });
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as { members: Array<{ uid: string; outputBudget?: string; defaultModel?: string }> };
  const row = body.members.find((candidate) => candidate.uid === uid);
  expect(row, `member ${uid} missing from the ${ORG_HANDLE} roster`).toBeDefined();
  return { outputBudget: row?.outputBudget, defaultModel: row?.defaultModel };
}

test.describe('Workspace model settings — API E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    await seedPostgresOrganizationNamespace(ORG_HANDLE, TEST_USER_ID, 'Model Settings Org');
    await createTestUser(MEMBER_EMAIL, MEMBER_PASSWORD, 'Model Settings Member');
    const invite = await request.post('/api/users/invite', {
      headers: apiKeyHeaders(),
      data: { email: MEMBER_EMAIL, namespaceHandle: ORG_HANDLE, role: 'member' },
    });
    expect(invite.status(), await invite.text()).toBe(201);
    member = {
      uid: (await invite.json()).uid,
      sessionCookie: await signInAndGetSessionCookie(MEMBER_EMAIL, MEMBER_PASSWORD),
    };
  });

  test('the workspace budget persists through PATCH → GET, and default clears it', async ({ request }) => {
    const setRes = await request.patch(namespaceUrl, { headers: apiKeyHeaders(), data: { outputBudget: 'high' } });
    expect(setRes.ok(), await setRes.text()).toBe(true);

    const afterSet = await request.get(namespaceUrl, { headers: apiKeyHeaders() });
    expect(((await afterSet.json()) as { namespace: { outputBudget?: string } }).namespace.outputBudget).toBe('high');

    const clearRes = await request.patch(namespaceUrl, { headers: apiKeyHeaders(), data: { outputBudget: 'default' } });
    expect(clearRes.ok(), await clearRes.text()).toBe(true);

    const afterClear = await request.get(namespaceUrl, { headers: apiKeyHeaders() });
    expect(((await afterClear.json()) as { namespace: { outputBudget?: string } }).namespace.outputBudget).toBeUndefined();
  });

  test('rejects an unknown workspace budget', async ({ request }) => {
    const res = await request.patch(namespaceUrl, { headers: apiKeyHeaders(), data: { outputBudget: 'huge' } });
    expect(res.status(), await res.text()).toBe(400);
  });

  test('a plain member cannot change the workspace budget', async ({ request }) => {
    const res = await request.patch(namespaceUrl, { headers: sessionCookieHeaders(member), data: { outputBudget: 'max' } });
    expect(res.status(), await res.text()).toBe(403);
  });

  test('a member sets their own budget and clears it back to the workspace', async ({ request }) => {
    const setRes = await request.put(memberSettingsUrl, { headers: sessionCookieHeaders(member), data: { outputBudget: 'low' } });
    expect(setRes.status(), await setRes.text()).toBe(200);
    expect((await memberSettingsOf(request, member.uid)).outputBudget).toBe('low');

    const clearRes = await request.put(memberSettingsUrl, { headers: sessionCookieHeaders(member), data: { outputBudget: null } });
    expect(clearRes.status(), await clearRes.text()).toBe(200);
    expect((await memberSettingsOf(request, member.uid)).outputBudget).toBeUndefined();
  });

  test('the workspace default model persists through PATCH → GET, and null clears it', async ({ request }) => {
    const setRes = await request.patch(namespaceUrl, { headers: apiKeyHeaders(), data: { defaultModel: LIVE_MODEL } });
    expect(setRes.ok(), await setRes.text()).toBe(true);

    const afterSet = await request.get(namespaceUrl, { headers: apiKeyHeaders() });
    expect(((await afterSet.json()) as { namespace: { defaultModel?: string } }).namespace.defaultModel).toBe(LIVE_MODEL);

    const clearRes = await request.patch(namespaceUrl, { headers: apiKeyHeaders(), data: { defaultModel: null } });
    expect(clearRes.ok(), await clearRes.text()).toBe(true);

    const afterClear = await request.get(namespaceUrl, { headers: apiKeyHeaders() });
    expect(((await afterClear.json()) as { namespace: { defaultModel?: string } }).namespace.defaultModel).toBeUndefined();
  });

  test('rejects a default model the registry does not list, and a moving alias', async ({ request }) => {
    const unknown = await request.patch(namespaceUrl, { headers: apiKeyHeaders(), data: { defaultModel: 'nobody/no-such-model' } });
    expect(unknown.status(), await unknown.text()).toBe(400);
    const alias = await request.put(memberSettingsUrl, { headers: sessionCookieHeaders(member), data: { defaultModel: '~anthropic/claude-sonnet-latest' } });
    expect(alias.status(), await alias.text()).toBe(400);
  });

  test('a member sets their own default model without touching their budget, then clears it', async ({ request }) => {
    await request.put(memberSettingsUrl, { headers: sessionCookieHeaders(member), data: { outputBudget: 'max' } });
    const setRes = await request.put(memberSettingsUrl, { headers: sessionCookieHeaders(member), data: { defaultModel: LIVE_MODEL } });
    expect(setRes.status(), await setRes.text()).toBe(200);
    expect(await memberSettingsOf(request, member.uid)).toEqual({ outputBudget: 'max', defaultModel: LIVE_MODEL });

    const clearRes = await request.put(memberSettingsUrl, { headers: sessionCookieHeaders(member), data: { outputBudget: null, defaultModel: null } });
    expect(clearRes.status(), await clearRes.text()).toBe(200);
    expect(await memberSettingsOf(request, member.uid)).toEqual({ outputBudget: undefined, defaultModel: undefined });
  });

  test('an API key has no member settings of its own', async ({ request }) => {
    const res = await request.put(memberSettingsUrl, { headers: apiKeyHeaders(), data: { outputBudget: 'low' } });
    expect(res.status(), await res.text()).toBe(403);
  });

  test('rejects an unauthenticated member settings write', async ({ request }) => {
    const res = await request.put(memberSettingsUrl, { data: { outputBudget: 'low' } });
    expect(res.status()).toBe(401);
  });
});
