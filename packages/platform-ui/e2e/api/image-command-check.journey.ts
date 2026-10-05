import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  sessionCookieHeaders,
  setupMultiNamespaceCallers,
  TEST_ORG_HANDLE,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

/**
 * L3 API journey for "does this image provide this command?" — the question an
 * MCP catalog entry raises when its `command` is `uvx` and a step runs it in an
 * image that may not carry it.
 *
 * What is asserted here is the route's contract: input validation, the auth
 * gate, and that an image the daemon does not hold is refused rather than
 * handed to `docker run`. The probe's answer itself depends on a daemon and is
 * covered by the handler's unit tests; a deployment with no reachable daemon
 * answers `unknown`, which is a valid 200.
 */

let callers: MultiNamespaceFixture;
const ORG_HANDLE = TEST_ORG_HANDLE;

function checkUrl(handle: string, image: string, command: string): string {
  const params = new URLSearchParams({ namespace: handle, image, command });
  return `/api/image-catalog/command-check?${params.toString()}`;
}

test.describe('Checking a command against an image — API E2E', () => {
  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('refuses a name that is not a bare command', async ({ request }) => {
    for (const command of ['a;b', '--help', '/usr/bin/uvx', 'uvx serve']) {
      const res = await request.get(checkUrl(ORG_HANDLE, 'mediforce-golden-image', command), {
        headers: sessionCookieHeaders(callers.member),
      });
      expect(res.status(), command).toBe(400);
    }
  });

  test('needs a caller', async ({ request }) => {
    const res = await request.get(checkUrl(ORG_HANDLE, 'mediforce-golden-image', 'uvx'));
    expect(res.status()).toBe(401);
  });

  test('refuses a caller outside the workspace', async ({ request }) => {
    const res = await request.get(checkUrl(ORG_HANDLE, 'mediforce-golden-image', 'uvx'), {
      headers: sessionCookieHeaders(callers.outsider),
    });
    expect(res.status()).toBe(403);
  });

  test('answers present, absent or unknown for a member — never an error — or 404s an image the daemon lacks', async ({ request }) => {
    const res = await request.get(checkUrl(ORG_HANDLE, 'mediforce-golden-image', 'uvx'), {
      headers: apiKeyHeaders(),
    });
    // 404 only when a reachable daemon does not hold the default image.
    expect([200, 404], await res.text()).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as { status: string; available?: boolean };
      expect(['known', 'unknown']).toContain(body.status);
    }
  });

  test('never hands an image reference the daemon does not list to docker', async ({ request }) => {
    const res = await request.get(checkUrl(ORG_HANDLE, '--privileged', 'uvx'), {
      headers: apiKeyHeaders(),
    });
    // `unknown` (200) when no daemon is reachable; 404 when one is and lacks it.
    expect([200, 404], await res.text()).toContain(res.status());
    if (res.status() === 200) expect(await res.json()).toEqual({ status: 'unknown' });
  });
});
