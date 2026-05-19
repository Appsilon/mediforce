import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPluginList = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    pluginRegistry: { list: mockPluginList },
    namespaceRepo: {},
  }),
}));

const mockResolveCallerIdentity = vi.fn();

vi.mock('@/lib/api-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth')>('@/lib/api-auth');
  return {
    ...actual,
    resolveCallerIdentity: (...args: unknown[]) => mockResolveCallerIdentity(...args),
  };
});

import { GET } from '../route';

function makeRequest() {
  return new Request('http://localhost/api/plugins', {
    headers: { 'X-Api-Key': 'test-key' },
  });
}

describe('GET /api/plugins', () => {
  beforeEach(() => {
    mockPluginList.mockReset();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey' });
  });

  it('[DATA] returns plugins wrapped in { plugins }', async () => {
    mockPluginList.mockReturnValue([
      { name: 'claude-code-agent', metadata: undefined },
      { name: 'echo-agent', metadata: undefined },
    ]);

    const res = await GET(makeRequest(), undefined);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plugins).toHaveLength(2);
    expect(body.plugins[0].name).toBe('claude-code-agent');
  });

  it('[DATA] returns empty array when no plugins are registered', async () => {
    mockPluginList.mockReturnValue([]);

    const res = await GET(makeRequest(), undefined);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plugins).toEqual([]);
  });

  it('[AUTH] returns 401 when caller resolution fails', async () => {
    // Plugins is `@public-handler` — no namespace gate — but the adapter
    // still enforces auth before the handler runs. A 401 from caller
    // resolution short-circuits the request.
    const { NextResponse } = await import('next/server');
    mockResolveCallerIdentity.mockReturnValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    const res = await GET(makeRequest(), undefined);

    expect(res.status).toBe(401);
  });
});
