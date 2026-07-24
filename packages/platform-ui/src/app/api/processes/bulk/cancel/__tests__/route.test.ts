import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockInstanceGetById = vi.fn();
const mockInstanceUpdate = vi.fn();
const mockInstanceGetStepExecutions = vi.fn();
const mockInstanceUpdateStepExecution = vi.fn();
const mockAgentRunGetByInstanceId = vi.fn();
const mockAgentRunUpdate = vi.fn();
const mockAuditAppend = vi.fn();
const mockTaskGetByInstanceId = vi.fn();
const mockTaskCancel = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    instanceRepo: {
      getById: mockInstanceGetById,
      update: mockInstanceUpdate,
      getStepExecutions: mockInstanceGetStepExecutions,
      updateStepExecution: mockInstanceUpdateStepExecution,
    },
    agentRunRepo: {
      getByInstanceId: mockAgentRunGetByInstanceId,
      update: mockAgentRunUpdate,
    },
    auditRepo: { append: mockAuditAppend },
    humanTaskRepo: { getByInstanceId: mockTaskGetByInstanceId, cancel: mockTaskCancel },
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
  return new NextRequest('http://localhost/api/processes/bulk/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const runningRun = (id: string) => ({
  id,
  definitionName: 'wf-1',
  definitionVersion: 1,
  namespace: 'ns-1',
  status: 'running' as const,
  archived: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
});

const completedRun = (id: string) => ({ ...runningRun(id), status: 'completed' as const });

describe('POST /api/processes/bulk/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockInstanceUpdate.mockResolvedValue(undefined);
    mockInstanceGetStepExecutions.mockResolvedValue([]);
    mockInstanceUpdateStepExecution.mockResolvedValue(undefined);
    mockAgentRunGetByInstanceId.mockResolvedValue([]);
    mockAgentRunUpdate.mockResolvedValue(undefined);
    mockTaskGetByInstanceId.mockResolvedValue([]);
    mockTaskCancel.mockResolvedValue(undefined);
  });

  it('[DATA] cancels each running run; per-item ok results', async () => {
    mockInstanceGetById.mockImplementation(async (id: string) => runningRun(id));

    const res = await POST(makeRequest({ runIds: ['r1', 'r2'] }), {});
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results).toEqual([
      { id: 'r1', status: 'ok' },
      { id: 'r2', status: 'ok' },
    ]);
  });

  it('[DATA] mixed batch: completed runs surface as per-item error, never aborts', async () => {
    mockInstanceGetById.mockImplementation(async (id: string) =>
      id === 'r-done' ? completedRun(id) : runningRun(id),
    );

    const res = await POST(makeRequest({ runIds: ['r1', 'r-done', 'r2'] }), {});
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results).toHaveLength(3);
    const byId = Object.fromEntries(
      (json.results as Array<{ id: string; status: string; error?: string }>).map((r) => [
        r.id,
        r,
      ]),
    );
    expect(byId.r1.status).toBe('ok');
    expect(byId.r2.status).toBe('ok');
    expect(byId['r-done'].status).toBe('error');
  });

  it('[ERROR] returns 400 when runIds is empty', async () => {
    const res = await POST(makeRequest({ runIds: [] }), {});
    expect(res.status).toBe(400);
  });
});
