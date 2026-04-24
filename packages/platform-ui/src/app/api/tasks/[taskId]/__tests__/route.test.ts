import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockGetById = vi.fn();
const mockClaim = vi.fn();
const mockComplete = vi.fn();
const mockAuditAppend = vi.fn();
const mockInstanceGetById = vi.fn();
const mockInstanceUpdate = vi.fn();
const mockAdvanceStep = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    humanTaskRepo: {
      getById: mockGetById,
      claim: mockClaim,
      complete: mockComplete,
    },
    auditRepo: { append: mockAuditAppend },
    instanceRepo: {
      getById: mockInstanceGetById,
      update: mockInstanceUpdate,
    },
    engine: { advanceStep: mockAdvanceStep },
  }),
  getAppBaseUrl: () => 'http://localhost:3000',
}));

// Suppress fire-and-forget fetch in complete route
vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response()));

import { GET } from '../route';
import { POST as claimRoute } from '../claim/route';
import { POST as completeRoute } from '../complete/route';

// ---- Helpers ----

const makeParams = (taskId: string) => Promise.resolve({ taskId });

function makePostRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const pendingTask = {
  id: 'task-1',
  processInstanceId: 'inst-1',
  stepId: 'generate-adam',
  assignedRole: 'reviewer',
  assignedUserId: null,
  status: 'pending',
  completionData: null,
  createdAt: '2026-03-11T10:00:00Z',
  updatedAt: '2026-03-11T10:00:00Z',
};

const claimedTask = {
  ...pendingTask,
  status: 'claimed',
  assignedUserId: 'user-1',
  completionData: {
    reviewType: 'agent_output_review',
    agentOutput: { result: { mock: true }, confidence: 0.8 },
  },
};

const pausedInstance = {
  id: 'inst-1',
  status: 'paused',
  currentStepId: 'generate-adam',
};

// ---- GET /api/tasks/:taskId ----
//
// Route-level smoke only. Handler behaviour is covered by
// `packages/platform-api/src/handlers/tasks/__tests__/get-task.test.ts`
// (against `InMemoryHumanTaskRepository`). Schema shapes by the contract
// test. What matters here is that the Next.js route wires the schema,
// services factory, and handler together — including the 404 mapping the
// adapter does when the handler throws `NotFoundError`.

describe('GET /api/tasks/:taskId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[DATA] returns task by id', async () => {
    mockGetById.mockResolvedValue(pendingTask);

    const req = new NextRequest('http://localhost/api/tasks/task-1');
    const res = await GET(req, { params: makeParams('task-1') });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.id).toBe('task-1');
    expect(mockGetById).toHaveBeenCalledWith('task-1');
  });

  it('[ERROR] returns 404 for unknown task', async () => {
    mockGetById.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/tasks/unknown');
    const res = await GET(req, { params: makeParams('unknown') });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('unknown');
  });
});

// ---- POST /api/tasks/:taskId/claim ----

describe('POST /api/tasks/:taskId/claim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[DATA] claims a pending task', async () => {
    mockGetById.mockResolvedValue(pendingTask);
    mockClaim.mockResolvedValue({ ...pendingTask, status: 'claimed', assignedUserId: 'user-1' });

    const req = makePostRequest('http://localhost/api/tasks/task-1/claim', { userId: 'user-1' });
    const res = await claimRoute(req, { params: makeParams('task-1') });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('claimed');
    expect(json.assignedUserId).toBe('user-1');
    expect(mockClaim).toHaveBeenCalledWith('task-1', 'user-1');
    expect(mockAuditAppend).toHaveBeenCalledTimes(1);
  });

  it('[DATA] defaults userId to api-user when not provided', async () => {
    mockGetById.mockResolvedValue(pendingTask);
    mockClaim.mockResolvedValue({ ...pendingTask, status: 'claimed', assignedUserId: 'api-user' });

    const req = makePostRequest('http://localhost/api/tasks/task-1/claim', {});
    const res = await claimRoute(req, { params: makeParams('task-1') });

    expect(res.status).toBe(200);
    expect(mockClaim).toHaveBeenCalledWith('task-1', 'api-user');
  });

  it('[ERROR] returns 404 for unknown task', async () => {
    mockGetById.mockResolvedValue(null);

    const req = makePostRequest('http://localhost/api/tasks/unknown/claim', { userId: 'user-1' });
    const res = await claimRoute(req, { params: makeParams('unknown') });

    expect(res.status).toBe(404);
  });

  it('[ERROR] returns 409 when task is not pending', async () => {
    mockGetById.mockResolvedValue(claimedTask);

    const req = makePostRequest('http://localhost/api/tasks/task-1/claim', { userId: 'user-1' });
    const res = await claimRoute(req, { params: makeParams('task-1') });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain('claimed');
  });
});

// ---- POST /api/tasks/:taskId/complete ----

describe('POST /api/tasks/:taskId/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstanceGetById.mockResolvedValue(pausedInstance);
    mockInstanceUpdate.mockResolvedValue(undefined);
    mockAdvanceStep.mockResolvedValue({ id: 'inst-1', status: 'running', currentStepId: 'generate-tlg' });
    mockComplete.mockResolvedValue({ ...claimedTask, status: 'completed' });
  });

  it('[DATA] completes a claimed task with approve verdict', async () => {
    mockGetById.mockResolvedValue(claimedTask);

    const req = makePostRequest('http://localhost/api/tasks/task-1/complete', {
      verdict: 'approve',
      comment: 'Looks good',
    });
    const res = await completeRoute(req, { params: makeParams('task-1') });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.verdict).toBe('approve');
    expect(mockComplete).toHaveBeenCalledWith('task-1', expect.objectContaining({ verdict: 'approve' }));
    expect(mockInstanceUpdate).toHaveBeenCalledWith('inst-1', expect.objectContaining({ status: 'running' }));
    expect(mockAdvanceStep).toHaveBeenCalled();
    expect(mockAuditAppend).toHaveBeenCalledTimes(2); // task.completed + process.resumed
  });

  it('[DATA] passes agent output to advanceStep for L3 review tasks', async () => {
    mockGetById.mockResolvedValue(claimedTask);

    const req = makePostRequest('http://localhost/api/tasks/task-1/complete', {
      verdict: 'approve',
      comment: '',
    });
    await completeRoute(req, { params: makeParams('task-1') });

    const advanceCall = mockAdvanceStep.mock.calls[0];
    const stepOutput = advanceCall[1] as Record<string, unknown>;
    expect(stepOutput.agentOutput).toEqual({ mock: true });
  });

  it('[ERROR] returns 400 for invalid verdict', async () => {
    const req = makePostRequest('http://localhost/api/tasks/task-1/complete', {
      verdict: 'reject',
    });
    const res = await completeRoute(req, { params: makeParams('task-1') });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('verdict');
  });

  it('[ERROR] returns 404 for unknown task', async () => {
    mockGetById.mockResolvedValue(null);

    const req = makePostRequest('http://localhost/api/tasks/task-1/complete', {
      verdict: 'approve',
    });
    const res = await completeRoute(req, { params: makeParams('task-1') });

    expect(res.status).toBe(404);
  });

  it('[ERROR] returns 409 when task is not claimed', async () => {
    mockGetById.mockResolvedValue(pendingTask);

    const req = makePostRequest('http://localhost/api/tasks/task-1/complete', {
      verdict: 'approve',
    });
    const res = await completeRoute(req, { params: makeParams('task-1') });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain('pending');
  });

  it('[ERROR] returns 409 when instance is not paused', async () => {
    mockGetById.mockResolvedValue(claimedTask);
    mockInstanceGetById.mockResolvedValue({ ...pausedInstance, status: 'running' });

    const req = makePostRequest('http://localhost/api/tasks/task-1/complete', {
      verdict: 'approve',
    });
    const res = await completeRoute(req, { params: makeParams('task-1') });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain('running');
  });
});
