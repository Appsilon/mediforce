import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetSecretKeys = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    secretsRepo: { getSecretKeys: mockGetSecretKeys },
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

function makeRequest(namespace: string | null, workflows: string[]): NextRequest {
  const url = new URL('http://localhost/api/workflow-secrets/keys-batch');
  if (namespace !== null) url.searchParams.set('namespace', namespace);
  for (const w of workflows) url.searchParams.append('workflow', w);
  return new NextRequest(url, { method: 'GET' });
}

describe('GET /api/workflow-secrets/keys-batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockGetSecretKeys.mockImplementation(async (_ns: string, wf: string) => (wf === 'wf-a' ? ['K1', 'K2'] : ['K3']));
  });

  it('[DATA] returns keys grouped by workflow', async () => {
    const res = await GET(makeRequest('ns-1', ['wf-a', 'wf-b']), {});
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ keysByWorkflow: { 'wf-a': ['K1', 'K2'], 'wf-b': ['K3'] } });
  });

  it('[AUTHZ] non-member soft-fails to [] per workflow (anti-enum)', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['other-ns']),
      isSystemActor: false,
    });

    const res = await GET(makeRequest('ns-1', ['wf-a', 'wf-b']), {});
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ keysByWorkflow: { 'wf-a': [], 'wf-b': [] } });
    expect(mockGetSecretKeys).not.toHaveBeenCalled();
  });

  it('[ERROR] returns 400 when no workflow query params provided', async () => {
    const res = await GET(makeRequest('ns-1', []), {});
    expect(res.status).toBe(400);
  });
});
