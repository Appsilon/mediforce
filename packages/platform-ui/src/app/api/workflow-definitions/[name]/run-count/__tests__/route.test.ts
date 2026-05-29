import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockCountInstances = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    processRepo: { countInstancesByDefinitionName: mockCountInstances },
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

const makeParams = (name: string) => Promise.resolve({ name });

function makeRequest(name: string, namespace: string | null): NextRequest {
  const url = new URL(`http://localhost/api/workflow-definitions/${encodeURIComponent(name)}/run-count`);
  if (namespace !== null) url.searchParams.set('namespace', namespace);
  return new NextRequest(url, { method: 'GET' });
}

describe('GET /api/workflow-definitions/:name/run-count', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockCountInstances.mockResolvedValue(7);
  });

  it('[DATA] returns count', async () => {
    const res = await GET(makeRequest('wf-1', 'ns-1'), { params: makeParams('wf-1') });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ count: 7 });
    expect(mockCountInstances).toHaveBeenCalledWith('ns-1', 'wf-1');
  });

  it('[AUTHZ] non-member soft-fails to 0 (anti-enum read)', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['other-ns']),
      isSystemActor: false,
    });

    const res = await GET(makeRequest('wf-1', 'ns-1'), { params: makeParams('wf-1') });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ count: 0 });
    expect(mockCountInstances).not.toHaveBeenCalled();
  });

  it('[ERROR] returns 400 when namespace is missing', async () => {
    const res = await GET(makeRequest('wf-1', null), { params: makeParams('wf-1') });
    expect(res.status).toBe(400);
  });
});
