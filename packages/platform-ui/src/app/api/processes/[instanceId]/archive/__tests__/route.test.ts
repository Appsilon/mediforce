import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockInstanceGetById = vi.fn();
const mockInstanceUpdate = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    instanceRepo: { getById: mockInstanceGetById, update: mockInstanceUpdate },
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

const makeParams = (instanceId: string) => Promise.resolve({ instanceId });

function makeRequest(instanceId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/processes/${instanceId}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const completedRun = {
  id: 'run-1',
  definitionName: 'wf-1',
  definitionVersion: 1,
  namespace: 'ns-1',
  status: 'completed' as const,
  archived: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const runningRun = { ...completedRun, status: 'running' as const };

describe('POST /api/processes/:instanceId/archive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockInstanceUpdate.mockResolvedValue(undefined);
  });

  it('[DATA] archives a completed run and emits audit', async () => {
    mockInstanceGetById.mockResolvedValue(completedRun);

    const res = await POST(makeRequest('run-1', { archived: true }), {
      params: makeParams('run-1'),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.run.id).toBe('run-1');
    expect(mockInstanceUpdate).toHaveBeenCalledWith('run-1', expect.objectContaining({ archived: true }));
    expect(mockAuditAppend).toHaveBeenCalledWith(expect.objectContaining({ action: 'instance.archived' }));
  });

  it('[ERROR] returns 409 (precondition_failed) when run is active', async () => {
    mockInstanceGetById.mockResolvedValue(runningRun);

    const res = await POST(makeRequest('run-1', { archived: true }), {
      params: makeParams('run-1'),
    });

    expect(res.status).toBe(409);
    expect(mockInstanceUpdate).not.toHaveBeenCalled();
  });

  it('[ERROR] returns 404 when run does not exist', async () => {
    mockInstanceGetById.mockResolvedValue(null);

    const res = await POST(makeRequest('missing', { archived: true }), {
      params: makeParams('missing'),
    });

    expect(res.status).toBe(404);
  });

  it('[ERROR] returns 400 when archived field is missing', async () => {
    mockInstanceGetById.mockResolvedValue(completedRun);

    const res = await POST(makeRequest('run-1', {}), { params: makeParams('run-1') });
    expect(res.status).toBe(400);
    expect(mockInstanceUpdate).not.toHaveBeenCalled();
  });
});
