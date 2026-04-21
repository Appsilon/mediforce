// packages/platform-ui/src/test/middleware.test.ts
// RED phase: these tests describe the middleware auth contract for Step 0 of the MCP permissions refactor.
// They will FAIL before middleware implementation.
// After middleware.ts is updated to centralize auth, run again to confirm GREEN.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

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

  it('allows GET /api/oauth/callback without any key', async () => {
    const res = await middleware(makeRequest('/api/oauth/callback'));
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
