import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockNamespaceGetSecrets = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    namespaceSecretsRepo: { getSecrets: mockNamespaceGetSecrets },
    secretsRepo: {},
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

function makeRequest(namespace: string | null): NextRequest {
  const url = new URL('http://localhost/api/workspace-secrets/previews');
  if (namespace !== null) url.searchParams.set('namespace', namespace);
  return new NextRequest(url, { method: 'GET' });
}

describe('GET /api/workspace-secrets/previews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
  });

  it('[DATA] long values are head-tail masked, short values bullet-masked', async () => {
    mockNamespaceGetSecrets.mockResolvedValue({
      LONG: 'abcdefghijklmnopqrst',
      SHORT: 'tiny',
    });

    const res = await GET(makeRequest('ns-1'), {});
    const json = await res.json();

    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(
      (json.previews as Array<{ key: string; preview: string }>).map((p) => [p.key, p.preview]),
    );
    expect(byKey.LONG).toBe('abcd...qrst');
    expect(byKey.SHORT).toBe('•'.repeat(8));
  });

  it('[AUTHZ] non-member soft-fails to empty previews (anti-enum)', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['other-ns']),
      isSystemActor: false,
    });

    const res = await GET(makeRequest('ns-1'), {});
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ previews: [] });
    expect(mockNamespaceGetSecrets).not.toHaveBeenCalled();
  });

  it('[ERROR] returns 400 when namespace missing', async () => {
    const res = await GET(makeRequest(null), {});
    expect(res.status).toBe(400);
  });
});
