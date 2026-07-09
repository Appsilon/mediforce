import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level smoke. Handler behaviour is covered exhaustively by
// `packages/platform-api/src/handlers/tasks/__tests__/list-tasks.test.ts`
// (8 tests against `InMemoryHumanTaskRepository`, no mocks). Schema shapes
// are covered by the contract test. The round-trip (client → adapter →
// handler → repo) is covered by `src/test/integration/api-integration.test.ts`.
//
// What remains here is one happy-path smoke that proves the Next.js route
// file actually wires the schema, services factory, and handler together,
// plus basic namespace filtering for authenticated users.

const mockGetByInstanceId = vi.fn();
const mockInstanceGetById = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    humanTaskRepo: {
      getByInstanceId: mockGetByInstanceId,
      getByRole: vi.fn(),
    },
    instanceRepo: {
      getById: mockInstanceGetById,
    },
    namespaceRepo: {},
  }),
}));

vi.mock('@/lib/api-auth', () => ({
  resolveCallerIdentity: () => ({ kind: 'apiKey', isSystemActor: true }),
  callerCanAccess: () => true,
}));

import { GET } from '../route';

describe('GET /api/tasks — route smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wires request → schema → services → handler and returns JSON tasks', async () => {
    mockGetByInstanceId.mockResolvedValue([
      {
        id: 'task-1',
        processInstanceId: 'inst-1',
        stepId: 'review-step',
        assignedRole: 'reviewer',
        assignedUserId: null,
        status: 'pending',
        deadline: null,
        createdAt: '2026-03-11T10:00:00Z',
        updatedAt: '2026-03-11T10:00:00Z',
        completedAt: null,
        completionData: null,
      },
    ]);

    const url = new URL('http://localhost/api/tasks');
    url.searchParams.set('instanceId', 'inst-1');
    const res = await GET(new NextRequest(url.toString()));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.tasks).toHaveLength(1);
    expect(mockGetByInstanceId).toHaveBeenCalledWith('inst-1');
  });
});
