import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  sessionCookieHeaders,
  setupMultiNamespaceCallers,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

/**
 * L3 API E2E for the mutation endpoints migrated to platform-api handlers
 * in Phase 3.1 (parity migration, no streaming):
 *   - POST /api/cowork/[sessionId]/chat
 *   - POST /api/cowork/[sessionId]/finalize
 *   - POST /api/cowork/[sessionId]/voice/ephemeral-key
 *   - POST /api/cowork/[sessionId]/voice/synthesize
 *
 * Happy paths require external LLM credentials (OpenRouter, OpenAI) so this
 * suite locks the auth + validation + anti-enum surface only. Handler
 * happy-path coverage lives in the L2 tests under
 * `packages/platform-api/src/handlers/cowork/__tests__/`.
 */

const SESSION_ID = 'cowork-active-1';
const MISSING_SESSION_ID = 'cowork-does-not-exist-zzz';

test.describe('POST /api/cowork/* — mutation E2E', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('chat: missing message → 400 validation', async ({ request }) => {
    const res = await request.post(`/api/cowork/${SESSION_ID}/chat`, {
      headers: { ...apiKeyHeaders(), 'Content-Type': 'application/json' },
      data: {},
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation');
  });

  test('chat: outsider user → 404 (anti-enum)', async ({ request }) => {
    const res = await request.post(`/api/cowork/${SESSION_ID}/chat`, {
      headers: { ...sessionCookieHeaders(callers.outsider), 'Content-Type': 'application/json' },
      data: { message: 'hi' },
    });
    expect(res.status()).toBe(404);
  });

  test('chat: missing session → 404', async ({ request }) => {
    const res = await request.post(`/api/cowork/${MISSING_SESSION_ID}/chat`, {
      headers: { ...apiKeyHeaders(), 'Content-Type': 'application/json' },
      data: { message: 'hi' },
    });
    expect(res.status()).toBe(404);
  });

  test('chat: no auth → 401 (middleware)', async ({ request }) => {
    const res = await request.post(`/api/cowork/${SESSION_ID}/chat`, {
      data: { message: 'hi' },
    });
    expect(res.status()).toBe(401);
  });

  test('finalize: missing artifact → 400 validation', async ({ request }) => {
    const res = await request.post(`/api/cowork/${SESSION_ID}/finalize`, {
      headers: { ...apiKeyHeaders(), 'Content-Type': 'application/json' },
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('finalize: outsider user → 404 (anti-enum)', async ({ request }) => {
    const res = await request.post(`/api/cowork/${SESSION_ID}/finalize`, {
      headers: { ...sessionCookieHeaders(callers.outsider), 'Content-Type': 'application/json' },
      data: { artifact: { x: 1 } },
    });
    expect(res.status()).toBe(404);
  });

  test('finalize: no auth → 401', async ({ request }) => {
    const res = await request.post(`/api/cowork/${SESSION_ID}/finalize`, {
      data: { artifact: { x: 1 } },
    });
    expect(res.status()).toBe(401);
  });

  test('voice/ephemeral-key: chat session (not voice-realtime) → 400', async ({ request }) => {
    const res = await request.post(`/api/cowork/${SESSION_ID}/voice/ephemeral-key`, {
      headers: apiKeyHeaders(),
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('validation');
    expect(body.error.message).toMatch(/voice-realtime/i);
  });

  test('voice/ephemeral-key: outsider user → 404', async ({ request }) => {
    const res = await request.post(`/api/cowork/${SESSION_ID}/voice/ephemeral-key`, {
      headers: sessionCookieHeaders(callers.outsider),
    });
    expect(res.status()).toBe(404);
  });

  test('voice/synthesize: missing transcript → 400 validation', async ({ request }) => {
    const res = await request.post(`/api/cowork/${SESSION_ID}/voice/synthesize`, {
      headers: { ...apiKeyHeaders(), 'Content-Type': 'application/json' },
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('voice/synthesize: outsider user → 404', async ({ request }) => {
    const res = await request.post(`/api/cowork/${SESSION_ID}/voice/synthesize`, {
      headers: { ...sessionCookieHeaders(callers.outsider), 'Content-Type': 'application/json' },
      data: { transcript: 'User: hi' },
    });
    expect(res.status()).toBe(404);
  });

  test('legacy /message endpoint is removed → 404', async ({ request }) => {
    const res = await request.post(`/api/cowork/${SESSION_ID}/message`, {
      headers: { ...apiKeyHeaders(), 'Content-Type': 'application/json' },
      data: { message: 'hi' },
    });
    expect(res.status()).toBe(404);
  });
});
