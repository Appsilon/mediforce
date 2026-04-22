import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockGetByInstanceId = vi.fn();
const mockGetByRole = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    humanTaskRepo: {
      getByInstanceId: mockGetByInstanceId,
      getByRole: mockGetByRole,
    },
  }),
}));

import { GET } from '../route';

// ---- Helpers ----

function makeGetRequest(params?: Record<string, string | string[]>): NextRequest {
  const url = new URL('http://localhost/api/tasks');
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) {
        for (const val of v) url.searchParams.append(k, val);
      } else {
        url.searchParams.set(k, v);
      }
    }
  }
  return new NextRequest(url.toString());
}

const pendingTask = {
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
};

const claimedTask = {
  ...pendingTask,
  id: 'task-2',
  status: 'claimed',
  assignedUserId: 'user-1',
};

// ---- Tests ----

describe('GET /api/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[DATA] returns tasks filtered by instanceId', async () => {
    mockGetByInstanceId.mockResolvedValue([pendingTask, claimedTask]);

    const res = await GET(makeGetRequest({ instanceId: 'inst-1' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.tasks).toHaveLength(2);
    expect(mockGetByInstanceId).toHaveBeenCalledWith('inst-1');
  });

  it('[DATA] filters by status when instanceId provided', async () => {
    mockGetByInstanceId.mockResolvedValue([pendingTask, claimedTask]);

    const res = await GET(makeGetRequest({ instanceId: 'inst-1', status: 'pending' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.tasks).toHaveLength(1);
    expect(json.tasks[0].status).toBe('pending');
  });

  it('[DATA] returns tasks filtered by role', async () => {
    mockGetByRole.mockResolvedValue([pendingTask]);

    const res = await GET(makeGetRequest({ role: 'reviewer' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.tasks).toHaveLength(1);
    expect(mockGetByRole).toHaveBeenCalledWith('reviewer');
  });

  it('[DATA] filters by status when role provided', async () => {
    mockGetByRole.mockResolvedValue([pendingTask, claimedTask]);

    const res = await GET(makeGetRequest({ role: 'reviewer', status: 'claimed' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.tasks).toHaveLength(1);
    expect(json.tasks[0].status).toBe('claimed');
  });

  it('[DATA] filters by multi-status at the route layer (repeatable ?status=)', async () => {
    mockGetByRole.mockResolvedValue([
      pendingTask,
      claimedTask,
      { ...pendingTask, id: 'task-3', status: 'completed' },
    ]);

    const res = await GET(makeGetRequest({ role: 'reviewer', status: ['pending', 'claimed'] }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.tasks).toHaveLength(2);
    expect(json.tasks.map((t: { id: string }) => t.id).sort()).toEqual(['task-1', 'task-2']);
  });

  it('[ERROR] returns 400 when no filter provided', async () => {
    const res = await GET(makeGetRequest());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/exactly one of/i);
  });
});
