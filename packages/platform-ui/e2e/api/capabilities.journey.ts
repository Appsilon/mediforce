import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  sessionCookieHeaders,
  setupMultiNamespaceCallers,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

/**
 * L3 API E2E for GET /api/capabilities.
 *
 * What this instance can run is deployment-wide, so every authenticated caller
 * gets the same answer regardless of namespace — asserted from both an api-key
 * caller and a user-kind caller in a foreign namespace, to prove the route does
 * not accidentally gate it the way `/api/admin/email-status` is gated.
 *
 * The response is derived on purpose. The picker needs to know that email works
 * and roughly how, never which env vars are set — so the body is checked for
 * absence of env var names and of the configured from-address.
 */

type CapabilitiesBody = {
  capabilities: Record<string, { available: boolean; detail?: string; reason?: string }>;
};

/** Keys the picker gates blocks on today. */
const EXPECTED_KEYS = ['email', 'agents'];

test.describe('GET /api/capabilities — API E2E', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('rejects an unauthenticated caller', async ({ request }) => {
    const res = await request.get('/api/capabilities');
    expect(res.status()).toBe(401);
  });

  test('api-key caller receives a status for every gated capability', async ({ request }) => {
    const res = await request.get('/api/capabilities', { headers: apiKeyHeaders() });
    expect(res.status(), await res.text()).toBe(200);

    const body = await res.json() as CapabilitiesBody;
    for (const key of EXPECTED_KEYS) {
      expect(body.capabilities[key], `missing capability: ${key}`).toBeDefined();
      expect(typeof body.capabilities[key].available).toBe('boolean');
    }
  });

  test('an unavailable capability says who can fix it', async ({ request }) => {
    const res = await request.get('/api/capabilities', { headers: apiKeyHeaders() });
    const body = await res.json() as CapabilitiesBody;

    for (const [key, status] of Object.entries(body.capabilities)) {
      if (status.available) continue;
      expect(status.reason, `${key} is unavailable with no reason`).toBeTruthy();
    }
  });

  test('a user in another namespace sees the same deployment-wide answer', async ({ request }) => {
    const asApiKey = await (await request.get('/api/capabilities', { headers: apiKeyHeaders() })).json() as CapabilitiesBody;
    const asOutsider = await request.get('/api/capabilities', {
      headers: sessionCookieHeaders(callers.outsider),
    });

    expect(asOutsider.status(), await asOutsider.text()).toBe(200);
    expect((await asOutsider.json() as CapabilitiesBody).capabilities).toEqual(asApiKey.capabilities);
  });

  test('never returns env var names or the configured sender address', async ({ request }) => {
    const res = await request.get('/api/capabilities', { headers: apiKeyHeaders() });
    const raw = await res.text();

    for (const leak of [
      'MAILGUN_API_KEY', 'MAILGUN_DOMAIN', 'MAILGUN_FROM_EMAIL',
      'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM_EMAIL',
      'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY',
    ]) {
      expect(raw, `leaked env var name: ${leak}`).not.toContain(leak);
    }
    // A from-address would be the other way this leaks configuration.
    expect(raw).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});
