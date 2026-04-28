// packages/platform-ui/src/test/middleware.test.ts
// RED phase: these tests describe the middleware auth contract for Step 0 of the MCP permissions refactor.
// They will FAIL before middleware implementation.
// After middleware.ts is updated to centralize auth, run again to confirm GREEN.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

const EMULATOR_ISS = 'https://securetoken.google.com/demo-mediforce';
const EMULATOR_AUD = 'demo-mediforce';

function base64urlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function buildEmulatorToken(payload: Record<string, unknown>): string {
  const header = base64urlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = base64urlEncode(JSON.stringify(payload));
  return `${header}.${body}.`;
}

function validEmulatorPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: EMULATOR_ISS,
    aud: EMULATOR_AUD,
    sub: 'test-user-uid',
    iat: now - 10,
    exp: now + 3600,
    email: 'test@mediforce.dev',
    ...overrides,
  };
}

function makeRequest(
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: options.method ?? 'GET',
    headers: options.headers ?? {},
  });
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

describe('middleware auth guard', () => {
  beforeEach(() => {
    vi.stubEnv('PLATFORM_API_KEY', 'test-secret-key');
  });

  it('returns 401 when /api/workflow-definitions is called without X-Api-Key', async () => {
    const res = await middleware(makeRequest('/api/workflow-definitions'));
    expect(res.status).toBe(401);
    const body = await readJsonBody(res);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when X-Api-Key is wrong', async () => {
    const res = await middleware(
      makeRequest('/api/workflow-definitions', { headers: { 'X-Api-Key': 'wrong-key' } }),
    );
    expect(res.status).toBe(401);
    const body = await readJsonBody(res);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('passes through when X-Api-Key matches PLATFORM_API_KEY', async () => {
    const res = await middleware(
      makeRequest('/api/workflow-definitions', { headers: { 'X-Api-Key': 'test-secret-key' } }),
    );
    expect(res.status).not.toBe(401);
    const body = await readJsonBody(res);
    expect(body).not.toEqual({ error: 'Unauthorized' });
  });
});

describe('middleware public routes', () => {
  beforeEach(() => {
    vi.stubEnv('PLATFORM_API_KEY', 'test-secret-key');
  });

  it('allows GET /api/health without any key', async () => {
    const res = await middleware(makeRequest('/api/health'));
    expect(res.status).not.toBe(401);
  });

  it('allows GET /api/oauth/:provider/callback without any key', async () => {
    const res = await middleware(makeRequest('/api/oauth/github-mock/callback'));
    expect(res.status).not.toBe(401);
  });
});

describe('middleware admin prefix', () => {
  beforeEach(() => {
    vi.stubEnv('PLATFORM_API_KEY', 'test-secret-key');
  });

  it('returns 401 when /api/admin/tool-catalog is called without key', async () => {
    const res = await middleware(makeRequest('/api/admin/tool-catalog'));
    expect(res.status).toBe(401);
  });

  it('passes through /api/admin/tool-catalog with valid PLATFORM_API_KEY', async () => {
    // TODO(#218): tighten to PLATFORM_ADMIN_API_KEY when tier split lands
    const res = await middleware(
      makeRequest('/api/admin/tool-catalog', { headers: { 'X-Api-Key': 'test-secret-key' } }),
    );
    expect(res.status).not.toBe(401);
  });
});

describe('middleware preflight', () => {
  beforeEach(() => {
    vi.stubEnv('PLATFORM_API_KEY', 'test-secret-key');
  });

  it('allows OPTIONS preflight without auth', async () => {
    const res = await middleware(makeRequest('/api/workflow-definitions', { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
  });
});

describe('middleware Firebase ID token (emulator mode)', () => {
  beforeEach(() => {
    vi.stubEnv('PLATFORM_API_KEY', 'test-secret-key');
    vi.stubEnv('NEXT_PUBLIC_USE_EMULATORS', 'true');
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'demo-mediforce');
  });

  it('passes when Authorization: Bearer carries a valid emulator ID token', async () => {
    const token = buildEmulatorToken(validEmulatorPayload());
    const res = await middleware(
      makeRequest('/api/agent-definitions', { headers: { Authorization: `Bearer ${token}` } }),
    );
    expect(res.status).not.toBe(401);
  });

  it('returns 401 when Bearer token is malformed (not a JWT)', async () => {
    const res = await middleware(
      makeRequest('/api/agent-definitions', { headers: { Authorization: 'Bearer not-a-jwt' } }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 when Bearer token is expired', async () => {
    const token = buildEmulatorToken(
      validEmulatorPayload({ exp: Math.floor(Date.now() / 1000) - 10, iat: Math.floor(Date.now() / 1000) - 3610 }),
    );
    const res = await middleware(
      makeRequest('/api/agent-definitions', { headers: { Authorization: `Bearer ${token}` } }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 when Bearer token aud does not match project', async () => {
    const token = buildEmulatorToken(validEmulatorPayload({ aud: 'other-project' }));
    const res = await middleware(
      makeRequest('/api/agent-definitions', { headers: { Authorization: `Bearer ${token}` } }),
    );
    expect(res.status).toBe(401);
  });

  it('accepts X-Api-Key when present even if Authorization is missing', async () => {
    // Regression guard: adding Bearer support must not break server-to-server X-Api-Key auth
    const res = await middleware(
      makeRequest('/api/agent-definitions', { headers: { 'X-Api-Key': 'test-secret-key' } }),
    );
    expect(res.status).not.toBe(401);
  });

  it('accepts valid Bearer even when X-Api-Key is wrong', async () => {
    // Either credential is sufficient
    const token = buildEmulatorToken(validEmulatorPayload());
    const res = await middleware(
      makeRequest('/api/agent-definitions', {
        headers: { Authorization: `Bearer ${token}`, 'X-Api-Key': 'wrong' },
      }),
    );
    expect(res.status).not.toBe(401);
  });
});
