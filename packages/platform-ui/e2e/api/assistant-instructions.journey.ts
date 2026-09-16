import { test, expect } from '../helpers/test-fixtures';
import {
  OUTSIDER_NAMESPACE,
  apiKeyHeaders,
  sessionCookieHeaders,
  setupMultiNamespaceCallers,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';
import { TEST_ORG_HANDLE } from '../helpers/constants';

/**
 * L3 API E2E for the standing instructions the workflow assistant reads:
 *   - GET /api/workflow-assistant/instructions?namespace=…
 *   - PUT /api/workflow-assistant/instructions
 *
 * What only this level proves: the row really round-trips through Postgres, the
 * session cookie really resolves to the uid the row is keyed by, and the
 * `(workspace, uid)` gate really holds across two different signed-in people
 * rather than only across two fabricated `CallerIdentity` objects.
 */

const path = '/api/workflow-assistant/instructions';

// Serial: every test here reads and writes the same `(test, member)` row, so
// run in parallel they clobber each other's text rather than testing anything.
test.describe.configure({ mode: 'serial' });

test.describe('workflow assistant instructions — API E2E', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('unauthenticated request is rejected (401)', async ({ request }) => {
    const res = await request.get(`${path}?namespace=${TEST_ORG_HANDLE}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(401);
  });

  test('a signed-in member saves instructions and reads them back', async ({ request }) => {
    const instructions = 'Name every step after the artefact it produces.';
    const put = await request.put(path, {
      headers: sessionCookieHeaders(callers.member),
      data: { namespace: TEST_ORG_HANDLE, instructions },
    });
    expect(put.status(), await put.text()).toBe(200);

    const get = await request.get(`${path}?namespace=${TEST_ORG_HANDLE}`, {
      headers: sessionCookieHeaders(callers.member),
    });
    expect(get.status(), await get.text()).toBe(200);
    expect(await get.json()).toEqual({ instructions });
  });

  test('another signed-in person never sees them, and keeps their own', async ({ request }) => {
    // The outsider is not a member of `test`, so their read of it answers empty
    // rather than refusing — the same anti-enumeration shape secrets use.
    const foreign = await request.get(`${path}?namespace=${TEST_ORG_HANDLE}`, {
      headers: sessionCookieHeaders(callers.outsider),
    });
    expect(foreign.status(), await foreign.text()).toBe(200);
    expect(await foreign.json()).toEqual({ instructions: '' });

    // And their own workspace holds a different text entirely.
    const own = 'Always start from the golden-standard template.';
    const put = await request.put(path, {
      headers: sessionCookieHeaders(callers.outsider),
      data: { namespace: OUTSIDER_NAMESPACE, instructions: own },
    });
    expect(put.status(), await put.text()).toBe(200);

    const read = await request.get(`${path}?namespace=${OUTSIDER_NAMESPACE}`, {
      headers: sessionCookieHeaders(callers.outsider),
    });
    expect(await read.json()).toEqual({ instructions: own });
  });

  test('a session caller cannot name someone else’s uid (403)', async ({ request }) => {
    const res = await request.get(
      `${path}?namespace=${TEST_ORG_HANDLE}&uid=${callers.outsider.uid}`,
      { headers: sessionCookieHeaders(callers.member) },
    );
    expect(res.status(), await res.text()).toBe(403);
  });

  test('an apiKey caller must name the uid it is acting for (400)', async ({ request }) => {
    const res = await request.get(`${path}?namespace=${TEST_ORG_HANDLE}`, {
      headers: apiKeyHeaders(),
    });
    expect(res.status(), await res.text()).toBe(400);
  });

  test('the CLI path: an apiKey caller writes a person’s instructions, and that person reads them', async ({ request }) => {
    const pushed = 'Pushed from a conventions file.';
    const put = await request.put(path, {
      headers: apiKeyHeaders(),
      data: { namespace: TEST_ORG_HANDLE, uid: callers.member.uid, instructions: pushed },
    });
    expect(put.status(), await put.text()).toBe(200);

    const get = await request.get(`${path}?namespace=${TEST_ORG_HANDLE}`, {
      headers: sessionCookieHeaders(callers.member),
    });
    expect(await get.json()).toEqual({ instructions: pushed });
  });

  test('an empty string clears them', async ({ request }) => {
    const put = await request.put(path, {
      headers: sessionCookieHeaders(callers.member),
      data: { namespace: TEST_ORG_HANDLE, instructions: '' },
    });
    expect(put.status(), await put.text()).toBe(200);

    const get = await request.get(`${path}?namespace=${TEST_ORG_HANDLE}`, {
      headers: sessionCookieHeaders(callers.member),
    });
    expect(await get.json()).toEqual({ instructions: '' });
  });

  test('text past the cap is refused by the contract (400)', async ({ request }) => {
    const res = await request.put(path, {
      headers: sessionCookieHeaders(callers.member),
      data: { namespace: TEST_ORG_HANDLE, instructions: 'x'.repeat(10_001) },
    });
    expect(res.status(), await res.text()).toBe(400);
  });
});
