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
  validateApiKey: () => true,
}));

vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response()));

import { POST } from '../resolve/route';

// ---- Helpers ----

const makeParams = (taskId: string) => Promise.resolve({ taskId });

function makeRequest(taskId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/tasks/${taskId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const pausedInstance = {
  id: 'inst-1',
  status: 'paused',
  currentStepId: 'extract-metadata',
};

const advancedInstance = {
  id: 'inst-1',
  status: 'running',
  currentStepId: 'extract-metadata',
};

// ---- Verdict resolution ----

describe('POST /api/tasks/:taskId/resolve — verdict', () => {
  const claimedVerdictTask = {
    id: 'task-1',
    processInstanceId: 'inst-1',
    stepId: 'review-output',
    assignedRole: 'reviewer',
    assignedUserId: 'user-1',
    status: 'claimed',
    completionData: null,
    ui: undefined,
    createdAt: '2026-03-12T10:00:00Z',
    updatedAt: '2026-03-12T10:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInstanceGetById.mockResolvedValue(pausedInstance);
    mockInstanceUpdate.mockResolvedValue(undefined);
    mockAdvanceStep.mockResolvedValue(advancedInstance);
    mockComplete.mockResolvedValue({ ...claimedVerdictTask, status: 'completed' });
  });

  it('[DATA] resolves a claimed verdict task with approve', async () => {
    mockGetById.mockResolvedValue(claimedVerdictTask);
    // Return advanced instance on second call (for response)
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    const res = await POST(
      makeRequest('task-1', { verdict: 'approve', comment: 'LGTM' }),
      { params: makeParams('task-1') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.taskId).toBe('task-1');
    expect(json.resolvedStepId).toBe('review-output');
    expect(json.processInstanceId).toBe('inst-1');
    expect(json.nextStepId).toBe('extract-metadata');
    expect(json.status).toBe('running');
    expect(mockComplete).toHaveBeenCalledWith('task-1', expect.objectContaining({ verdict: 'approve', comment: 'LGTM' }));
    expect(mockAdvanceStep).toHaveBeenCalled();
    expect(mockAuditAppend).toHaveBeenCalledTimes(2);
  });

  it('[DATA] passes agent output for L3 review tasks', async () => {
    const l3Task = {
      ...claimedVerdictTask,
      completionData: {
        reviewType: 'agent_output_review',
        agentOutput: { result: { extracted: true }, confidence: 0.9 },
      },
    };
    mockGetById.mockResolvedValue(l3Task);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    await POST(
      makeRequest('task-1', { verdict: 'approve' }),
      { params: makeParams('task-1') },
    );

    const stepOutput = mockAdvanceStep.mock.calls[0][1] as Record<string, unknown>;
    expect(stepOutput.agentOutput).toEqual({ extracted: true });
  });

  it('[DATA] auto-claims pending task before resolving', async () => {
    const pendingTask = { ...claimedVerdictTask, status: 'pending', assignedUserId: null };
    const afterClaim = { ...claimedVerdictTask, status: 'claimed', assignedUserId: 'api-user' };
    mockGetById.mockResolvedValue(pendingTask);
    mockClaim.mockResolvedValue(afterClaim);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    const res = await POST(
      makeRequest('task-1', { verdict: 'approve' }),
      { params: makeParams('task-1') },
    );

    expect(res.status).toBe(200);
    expect(mockClaim).toHaveBeenCalledWith('task-1', 'api-user');
    expect(mockComplete).toHaveBeenCalled();
  });

  it('[ERROR] returns 400 for missing verdict', async () => {
    mockGetById.mockResolvedValue(claimedVerdictTask);

    const res = await POST(
      makeRequest('task-1', { comment: 'no verdict' }),
      { params: makeParams('task-1') },
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('verdict');
  });

  it('[ERROR] returns 400 for invalid verdict value', async () => {
    mockGetById.mockResolvedValue(claimedVerdictTask);

    const res = await POST(
      makeRequest('task-1', { verdict: 'reject' }),
      { params: makeParams('task-1') },
    );

    expect(res.status).toBe(400);
  });

  it('[ERROR] returns 404 for unknown task', async () => {
    mockGetById.mockResolvedValue(null);

    const res = await POST(
      makeRequest('unknown', { verdict: 'approve' }),
      { params: makeParams('unknown') },
    );

    expect(res.status).toBe(404);
  });

  it('[ERROR] returns 409 for completed task', async () => {
    mockGetById.mockResolvedValue({ ...claimedVerdictTask, status: 'completed' });

    const res = await POST(
      makeRequest('task-1', { verdict: 'approve' }),
      { params: makeParams('task-1') },
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('completed');
  });

  it('[ERROR] returns 409 when instance is not paused', async () => {
    mockGetById.mockResolvedValue(claimedVerdictTask);
    mockInstanceGetById.mockResolvedValue({ ...pausedInstance, status: 'running' });

    const res = await POST(
      makeRequest('task-1', { verdict: 'approve' }),
      { params: makeParams('task-1') },
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('running');
  });
});

// ---- File upload resolution ----

describe('POST /api/tasks/:taskId/resolve — file-upload', () => {
  const claimedUploadTask = {
    id: 'task-2',
    processInstanceId: 'inst-1',
    stepId: 'upload-documents',
    assignedRole: 'operator',
    assignedUserId: 'user-1',
    status: 'claimed',
    completionData: null,
    ui: {
      component: 'file-upload',
      config: {
        acceptedTypes: ['application/pdf'],
        minFiles: 1,
        maxFiles: 5,
      },
    },
    createdAt: '2026-03-12T10:00:00Z',
    updatedAt: '2026-03-12T10:00:00Z',
  };

  const validAttachments = [
    {
      name: 'protocol.pdf',
      size: 102400,
      type: 'application/pdf',
      storagePath: 'tasks/task-2/abc_protocol.pdf',
      downloadUrl: 'https://storage.example.com/protocol.pdf',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockInstanceGetById.mockResolvedValue(pausedInstance);
    mockInstanceUpdate.mockResolvedValue(undefined);
    mockAdvanceStep.mockResolvedValue(advancedInstance);
    mockComplete.mockResolvedValue({ ...claimedUploadTask, status: 'completed' });
  });

  it('[DATA] resolves a file-upload task with valid attachments', async () => {
    mockGetById.mockResolvedValue(claimedUploadTask);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    const res = await POST(
      makeRequest('task-2', { attachments: validAttachments }),
      { params: makeParams('task-2') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.resolvedStepId).toBe('upload-documents');

    // completionData should contain files array
    const completionArg = mockComplete.mock.calls[0][1] as Record<string, unknown>;
    const files = completionArg.files as Array<Record<string, unknown>>;
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('protocol.pdf');
    expect(files[0].uploadedAt).toBeDefined();

    // stepOutput to advanceStep should have files + taskId
    const stepOutput = mockAdvanceStep.mock.calls[0][1] as Record<string, unknown>;
    expect(stepOutput.files).toBeDefined();
    expect(stepOutput.taskId).toBe('task-2');
  });

  it('[DATA] auto-claims pending upload task', async () => {
    const pendingUpload = { ...claimedUploadTask, status: 'pending', assignedUserId: null };
    const afterClaim = { ...claimedUploadTask, status: 'claimed', assignedUserId: 'api-user' };
    mockGetById.mockResolvedValue(pendingUpload);
    mockClaim.mockResolvedValue(afterClaim);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    const res = await POST(
      makeRequest('task-2', { attachments: validAttachments }),
      { params: makeParams('task-2') },
    );

    expect(res.status).toBe(200);
    expect(mockClaim).toHaveBeenCalledWith('task-2', 'api-user');
  });

  it('[ERROR] returns 400 when attachments missing', async () => {
    mockGetById.mockResolvedValue(claimedUploadTask);

    const res = await POST(
      makeRequest('task-2', {}),
      { params: makeParams('task-2') },
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('attachments');
  });

  it('[ERROR] returns 400 when attachments is empty array', async () => {
    mockGetById.mockResolvedValue(claimedUploadTask);

    const res = await POST(
      makeRequest('task-2', { attachments: [] }),
      { params: makeParams('task-2') },
    );

    expect(res.status).toBe(400);
  });

  it('[ERROR] returns 400 when attachment has missing name', async () => {
    mockGetById.mockResolvedValue(claimedUploadTask);

    const res = await POST(
      makeRequest('task-2', {
        attachments: [{ size: 100, type: 'application/pdf' }],
      }),
      { params: makeParams('task-2') },
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('name');
  });

  it('[ERROR] returns 400 when too many files for maxFiles constraint', async () => {
    mockGetById.mockResolvedValue(claimedUploadTask);

    const tooMany = Array.from({ length: 6 }, (_, index) => ({
      name: `file-${index}.pdf`,
      size: 1000,
      type: 'application/pdf',
    }));

    const res = await POST(
      makeRequest('task-2', { attachments: tooMany }),
      { params: makeParams('task-2') },
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('1-5');
  });

  it('[ERROR] returns 400 when file type not accepted', async () => {
    mockGetById.mockResolvedValue(claimedUploadTask);

    const res = await POST(
      makeRequest('task-2', {
        attachments: [{ name: 'data.csv', size: 100, type: 'text/csv' }],
      }),
      { params: makeParams('task-2') },
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('text/csv');
  });

  it('[DATA] accepts extension-based types (e.g., .xpt)', async () => {
    const sdtmTask = {
      ...claimedUploadTask,
      stepId: 'upload-sdtm',
      ui: {
        component: 'file-upload',
        config: {
          acceptedTypes: ['.xpt', '.csv', 'application/octet-stream'],
          minFiles: 1,
          maxFiles: 50,
        },
      },
    };
    mockGetById.mockResolvedValue(sdtmTask);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    const res = await POST(
      makeRequest('task-2', {
        attachments: [{ name: 'dm.xpt', size: 5000, type: 'application/octet-stream' }],
      }),
      { params: makeParams('task-2') },
    );

    expect(res.status).toBe(200);
  });

  it('[DATA] triggers auto-runner after resolution', async () => {
    mockGetById.mockResolvedValue(claimedUploadTask);
    mockInstanceGetById
      .mockResolvedValueOnce(pausedInstance)
      .mockResolvedValueOnce(advancedInstance);

    await POST(
      makeRequest('task-2', { attachments: validAttachments }),
      { params: makeParams('task-2') },
    );

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/processes/inst-1/run'),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
