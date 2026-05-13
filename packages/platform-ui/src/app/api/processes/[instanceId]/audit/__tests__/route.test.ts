import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetByProcess = vi.fn();
const mockGetById = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    auditRepo: { getByProcess: mockGetByProcess },
    instanceRepo: { getById: mockGetById },
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

function makeRequest(instanceId: string) {
  const req = new Request(`http://localhost/api/processes/${instanceId}/audit`, {
    headers: { 'X-Api-Key': 'test-key' },
  });
  return { req, params: Promise.resolve({ instanceId }) };
}

describe('GET /api/processes/[instanceId]/audit', () => {
  beforeEach(() => {
    mockGetByProcess.mockReset();
    mockGetById.mockReset();
    mockGetById.mockResolvedValue({ id: 'inst-001', namespace: 'test-ns' });
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey' });
  });

  it('[DATA] returns audit events for a process instance wrapped in { events }', async () => {
    // Post-migration response shape: { events: AuditEvent[] } instead of bare
    // AuditEvent[]. Keeps the door open for pagination metadata without
    // breaking the wrapper.
    const events = [
      { action: 'step.started', timestamp: '2026-03-12T10:00:00Z', processInstanceId: 'inst-001' },
      { action: 'step.completed', timestamp: '2026-03-12T10:01:00Z', processInstanceId: 'inst-001' },
    ];
    mockGetByProcess.mockResolvedValue(events);
    const { req, params } = makeRequest('inst-001');

    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ events });
    expect(mockGetByProcess).toHaveBeenCalledWith('inst-001');
  });

  it('[DATA] returns empty array when no audit events exist', async () => {
    mockGetByProcess.mockResolvedValue([]);
    const { req, params } = makeRequest('inst-999');

    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ events: [] });
  });

  it('[ERROR] returns 404 when instance not found', async () => {
    mockGetById.mockResolvedValue(null);
    const { req, params } = makeRequest('inst-001');

    const res = await GET(req, { params });

    expect(res.status).toBe(404);
  });

  it('[ERROR] returns 500 with a generic message when repository throws', async () => {
    // The route adapter sanitises unexpected errors to a generic message so
    // backend details (Firestore stack traces, internal IDs) never leak to
    // clients. The original error is logged server-side.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetByProcess.mockRejectedValue(new Error('Firestore unavailable'));
    const { req, params } = makeRequest('inst-001');

    const res = await GET(req, { params });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal error');
    consoleError.mockRestore();
  });

  it('[AUTH] returns 403 when user is not a member of the instance namespace', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'outsider',
      namespaces: new Set(['other-ns']),
    });
    const { req, params } = makeRequest('inst-001');

    const res = await GET(req, { params });

    expect(res.status).toBe(403);
  });
});
