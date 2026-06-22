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

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/processes/bulk/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const completedRun = (id: string) => ({
  id,
  definitionName: 'wf-1',
  definitionVersion: 1,
  namespace: 'ns-1',
  status: 'completed' as const,
  archived: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
});

describe('POST /api/processes/bulk/archive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockInstanceUpdate.mockResolvedValue(undefined);
  });

  it('[DATA] archives all listed runs and surfaces per-item ok', async () => {
    mockInstanceGetById.mockImplementation(async (id: string) => completedRun(id));

    const res = await POST(makeRequest({ runIds: ['r1', 'r2'] }), {});
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results).toEqual([
      { id: 'r1', status: 'ok' },
      { id: 'r2', status: 'ok' },
    ]);
  });

  it('[DATA] never aborts batch — failures surface as per-item error entries', async () => {
    mockInstanceGetById.mockImplementation(async (id: string) => (id === 'r-missing' ? null : completedRun(id)));

    const res = await POST(makeRequest({ runIds: ['r1', 'r-missing', 'r2'] }), {});
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results).toHaveLength(3);
    const byId = Object.fromEntries(
      (json.results as Array<{ id: string; status: string; error?: string }>).map((r) => [r.id, r]),
    );
    expect(byId.r1.status).toBe('ok');
    expect(byId.r2.status).toBe('ok');
    expect(byId['r-missing'].status).toBe('error');
  });

  it('[ERROR] returns 400 when runIds is empty', async () => {
    const res = await POST(makeRequest({ runIds: [] }), {});
    expect(res.status).toBe(400);
  });
});
