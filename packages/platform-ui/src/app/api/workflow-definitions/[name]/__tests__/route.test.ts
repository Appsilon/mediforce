import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockCountInstances = vi.fn();
const mockSetDeleted = vi.fn();
const mockGetIdsByDefName = vi.fn();
const mockSoftDeleteByDefName = vi.fn();
const mockSetDeletedTasksByInstanceIds = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    processRepo: {
      countInstancesByDefinitionName: mockCountInstances,
      setWorkflowDeleted: mockSetDeleted,
    },
    instanceRepo: {
      getIdsByDefinitionName: mockGetIdsByDefName,
      setDeletedByDefinitionName: mockSoftDeleteByDefName,
    },
    humanTaskRepo: { setDeletedByInstanceIds: mockSetDeletedTasksByInstanceIds },
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

import { DELETE } from '../route';

const makeParams = (name: string) => Promise.resolve({ name });

function makeRequest(name: string, namespace: string | null, body: unknown): NextRequest {
  const url = new URL(`http://localhost/api/workflow-definitions/${encodeURIComponent(name)}`);
  if (namespace !== null) url.searchParams.set('namespace', namespace);
  return new NextRequest(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('DELETE /api/workflow-definitions/:name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockCountInstances.mockResolvedValue(3);
    mockSetDeleted.mockResolvedValue(undefined);
    mockGetIdsByDefName.mockResolvedValue(['r1', 'r2', 'r3']);
    mockSoftDeleteByDefName.mockResolvedValue(undefined);
    mockSetDeletedTasksByInstanceIds.mockResolvedValue(undefined);
  });

  it('[DATA] soft-deletes workflow + cascades when run-count matches', async () => {
    const res = await DELETE(makeRequest('wf-1', 'ns-1', { expectedRunCount: 3 }), {
      params: makeParams('wf-1'),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, deletedRuns: 3 });
    expect(mockSetDeleted).toHaveBeenCalledWith('ns-1', 'wf-1', true);
    expect(mockSoftDeleteByDefName).toHaveBeenCalledWith('wf-1', true);
    expect(mockSetDeletedTasksByInstanceIds).toHaveBeenCalledWith(['r1', 'r2', 'r3'], true);
    expect(mockAuditAppend).toHaveBeenCalledWith(expect.objectContaining({ action: 'workflow.delete' }));
  });

  it('[ERROR] returns 409 when expectedRunCount stale (concurrent run created)', async () => {
    mockCountInstances.mockResolvedValue(5);

    const res = await DELETE(makeRequest('wf-1', 'ns-1', { expectedRunCount: 3 }), {
      params: makeParams('wf-1'),
    });

    expect(res.status).toBe(409);
    expect(mockSetDeleted).not.toHaveBeenCalled();
  });

  it('[AUTHZ] non-member sees actual=0, expected=3 → 409 (never reveals true count)', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['other-ns']),
      isSystemActor: false,
    });

    const res = await DELETE(makeRequest('wf-1', 'ns-1', { expectedRunCount: 3 }), {
      params: makeParams('wf-1'),
    });

    expect(res.status).toBe(409);
    expect(mockSetDeleted).not.toHaveBeenCalled();
  });

  it('[ERROR] returns 400 when expectedRunCount is missing', async () => {
    const res = await DELETE(makeRequest('wf-1', 'ns-1', {}), {
      params: makeParams('wf-1'),
    });
    expect(res.status).toBe(400);
  });
});
