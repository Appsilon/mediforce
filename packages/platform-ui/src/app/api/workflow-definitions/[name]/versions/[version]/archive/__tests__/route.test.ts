import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSetVersionArchived = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    processRepo: { setVersionArchived: mockSetVersionArchived },
    auditRepo: { append: mockAuditAppend },
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

import { POST } from '../route';

const makeParams = (name: string, version: string) => Promise.resolve({ name, version });

function makeRequest(name: string, version: string, namespace: string | null, body: unknown): NextRequest {
  const url = new URL(
    `http://localhost/api/workflow-definitions/${encodeURIComponent(name)}/versions/${version}/archive`,
  );
  if (namespace !== null) url.searchParams.set('namespace', namespace);
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/workflow-definitions/:name/versions/:version/archive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockSetVersionArchived.mockResolvedValue(undefined);
  });

  it('[DATA] archives a version and emits audit', async () => {
    const res = await POST(makeRequest('wf-1', '3', 'ns-1', { archived: true }), {
      params: makeParams('wf-1', '3'),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, name: 'wf-1', version: 3, archived: true });
    expect(mockSetVersionArchived).toHaveBeenCalledWith('ns-1', 'wf-1', 3, true);
    expect(mockAuditAppend).toHaveBeenCalledWith(expect.objectContaining({ action: 'workflow.version_archived' }));
  });

  it('[ERROR] maps repo "not found" to 404', async () => {
    mockSetVersionArchived.mockRejectedValue(new Error('Version not found'));

    const res = await POST(makeRequest('wf-1', '99', 'ns-1', { archived: true }), {
      params: makeParams('wf-1', '99'),
    });

    expect(res.status).toBe(404);
  });

  it('[AUTHZ] returns 403 when caller lacks namespace membership', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['other-ns']),
      isSystemActor: false,
    });

    const res = await POST(makeRequest('wf-1', '3', 'ns-1', { archived: true }), {
      params: makeParams('wf-1', '3'),
    });

    expect(res.status).toBe(403);
    expect(mockSetVersionArchived).not.toHaveBeenCalled();
  });

  it('[ERROR] returns 400 when version is not a positive integer', async () => {
    const res = await POST(makeRequest('wf-1', '0', 'ns-1', { archived: true }), {
      params: makeParams('wf-1', '0'),
    });
    expect(res.status).toBe(400);
  });
});
