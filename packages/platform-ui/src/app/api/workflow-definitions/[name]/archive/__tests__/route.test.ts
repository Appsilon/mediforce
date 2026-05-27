import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetLatestVersion = vi.fn();
const mockGetWorkflowDefinition = vi.fn();
const mockSetProcessArchived = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    processRepo: {
      getLatestWorkflowVersion: mockGetLatestVersion,
      getWorkflowDefinition: mockGetWorkflowDefinition,
      setProcessArchived: mockSetProcessArchived,
    },
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

const makeParams = (name: string) => Promise.resolve({ name });

function makeRequest(name: string, namespace: string | null, body: unknown): NextRequest {
  const url = new URL(`http://localhost/api/workflow-definitions/${encodeURIComponent(name)}/archive`);
  if (namespace !== null) url.searchParams.set('namespace', namespace);
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/workflow-definitions/:name/archive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockGetLatestVersion.mockResolvedValue(2);
    mockSetProcessArchived.mockResolvedValue(undefined);
  });

  it('[DATA] archives workflow and emits audit', async () => {
    const res = await POST(makeRequest('wf-1', 'ns-1', { archived: true }), {
      params: makeParams('wf-1'),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, name: 'wf-1', archived: true });
    expect(mockSetProcessArchived).toHaveBeenCalledWith('wf-1', 'ns-1', true);
    expect(mockAuditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'workflow.archived', entityId: 'wf-1' }),
    );
  });

  it('[ERROR] returns 404 when workflow does not exist', async () => {
    mockGetLatestVersion.mockResolvedValue(0);

    const res = await POST(makeRequest('missing', 'ns-1', { archived: true }), {
      params: makeParams('missing'),
    });

    expect(res.status).toBe(404);
    expect(mockSetProcessArchived).not.toHaveBeenCalled();
  });

  it('[AUTHZ] returns 403 when caller lacks namespace membership (write gate)', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['other-ns']),
      isSystemActor: false,
    });
    // Wrapper's `getLatestVersion` re-checks visibility via getWorkflowDefinition
    // for non-members; mark workflow private → version=0 → 404, public → 403 on
    // setArchived write gate. We want the write-gate signal here.
    mockGetWorkflowDefinition.mockResolvedValue({ visibility: 'public' });

    const res = await POST(makeRequest('wf-1', 'ns-1', { archived: true }), {
      params: makeParams('wf-1'),
    });

    expect(res.status).toBe(403);
    expect(mockSetProcessArchived).not.toHaveBeenCalled();
  });

  it('[ERROR] returns 400 when namespace query param is missing', async () => {
    const res = await POST(makeRequest('wf-1', null, { archived: true }), {
      params: makeParams('wf-1'),
    });

    expect(res.status).toBe(400);
  });
});
