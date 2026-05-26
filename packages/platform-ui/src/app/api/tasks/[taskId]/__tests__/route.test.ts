import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockGetById = vi.fn();
const mockInstanceGetById = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    humanTaskRepo: { getById: mockGetById },
    auditRepo: { append: vi.fn() },
    instanceRepo: { getById: mockInstanceGetById },
    engine: { advanceStep: vi.fn() },
    namespaceRepo: {},
  }),
  getAppBaseUrl: () => 'http://localhost:3000',
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

// ---- GET /api/tasks/:taskId wiring smoke ----
//
// Workspace gating + anti-enum 404 live in scope.tasks (wrapper). Behaviour
// coverage:
//   - L1 wrapper in packages/platform-api/src/repositories/__tests__/
//   - L3 API E2E in packages/platform-ui/e2e/api/tasks-get.journey.ts
//   - Adapter pipeline in packages/platform-ui/src/lib/__tests__/route-adapter.test.ts
// This file only verifies the route is wired to getByIdAdapter on scope.tasks.

describe('GET /api/tasks/:taskId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
  });

  it('returns task by id (wiring smoke)', async () => {
    mockGetById.mockResolvedValue({
      id: 'task-1',
      processInstanceId: 'inst-1',
      stepId: 'generate-adam',
      assignedRole: 'reviewer',
      assignedUserId: null,
      status: 'pending',
      completionData: null,
      createdAt: '2026-03-11T10:00:00Z',
      updatedAt: '2026-03-11T10:00:00Z',
    });
    mockInstanceGetById.mockResolvedValue({ id: 'inst-1', namespace: 'test-ns', status: 'paused' });

    const req = new NextRequest('http://localhost/api/tasks/task-1');
    const res = await GET(req, { params: Promise.resolve({ taskId: 'task-1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.id).toBe('task-1');
    expect(mockGetById).toHaveBeenCalledWith('task-1');
  });
});
